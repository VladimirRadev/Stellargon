// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStellarOracle} from "./interfaces/IStellarOracle.sol";

/// @title StellarOracle - a human voting oracle: reporters vote on the outcome of real-world questions.
/// @notice Anyone can become a reporter by locking `reporterStake` VLAD; the admin can also add reporters without a
///         stake. Each reporter casts one vote per question inside [votingStart, votingEnd]. After votingEnd anyone
///         calls `finalize`: the option with the most votes wins; a tie for first place or zero votes gives INVALID.
///         Reporters who voted for a losing option lose `slashBps` of their stake, split equally among the reporters
///         who voted for the winner. Trust model (demo): nothing on chain checks the real world, so a majority of
///         reporters can finalize a wrong answer; the slashing only rewards agreeing with the majority.
contract StellarOracle is IStellarOracle, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");
    bytes32 public constant ASKER_ROLE = keccak256("ASKER_ROLE");
    uint8 public constant INVALID = 255;
    uint256 internal constant MAX_OPTIONS = 8;
    uint256 internal constant MAX_REPORTERS = 100; // bounds the reporter list and the voters per question (finalize loops)
    uint256 internal constant MAX_SLASH_BPS = 5000;

    IERC20 public immutable vlad;
    uint256 public immutable reporterStake;
    uint256 public immutable questionFee; // paid by reporters (not by askers) per question, sent to `sink`
    uint256 public immutable slashBps;
    address public immutable sink; // the Arena prize pool

    struct Question {
        string text;
        string[] options;
        address[] voters;
        uint32[8] votes;
        address asker;
        uint64 votingStart;
        uint64 votingEnd;
        bool finalized;
        uint8 winner;
    }

    Question[] internal _questions;
    address[] internal _reporters;
    mapping(address => uint256) internal _reporterSlot; // index in _reporters + 1; 0 = not listed
    mapping(uint256 => mapping(address => uint8)) internal _choice; // option + 1; 0 = has not voted
    mapping(address => uint256) public stakeOf;
    mapping(address => uint256) public openVotes; // votes on questions that are not finalized yet

    event ReporterJoined(address indexed reporter, uint256 stake);
    event ReporterLeft(address indexed reporter, uint256 returned);
    event ReporterAdded(address indexed reporter);
    event ReporterRemoved(address indexed reporter);
    event QuestionCreated(
        uint256 indexed qid, address indexed asker, string text, uint64 votingStart, uint64 votingEnd
    );
    event Voted(uint256 indexed qid, address indexed reporter, uint8 option);
    event Slashed(uint256 indexed qid, address indexed reporter, uint256 amount);
    event Rewarded(uint256 indexed qid, address indexed reporter, uint256 amount);
    event Finalized(uint256 indexed qid, uint8 winner, uint32[] votes);

    error NotReporter();
    error AlreadyReporter();
    error TooManyReporters();
    error HasOpenVotes();
    error BadOptions();
    error BadOption();
    error BadWindow();
    error UnknownQuestion();
    error VotingNotOpen();
    error VotingClosed();
    error AlreadyVoted();
    error NotFinalizable();
    error AlreadyFinalized();
    error BadParams();

    constructor(IERC20 vlad_, uint256 reporterStake_, uint256 questionFee_, uint256 slashBps_, address sink_) {
        if (reporterStake_ == 0 || slashBps_ > MAX_SLASH_BPS || sink_ == address(0)) revert BadParams();
        (vlad, reporterStake, questionFee, slashBps, sink) = (vlad_, reporterStake_, questionFee_, slashBps_, sink_);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ------------------------------------------------------------------ reporters

    /// @notice Lock `reporterStake` VLAD and become a reporter.
    function joinAsReporter() external nonReentrant {
        if (hasRole(REPORTER_ROLE, msg.sender)) revert AlreadyReporter();
        stakeOf[msg.sender] += reporterStake;
        _grantRole(REPORTER_ROLE, msg.sender);
        vlad.safeTransferFrom(msg.sender, address(this), reporterStake);
        emit ReporterJoined(msg.sender, reporterStake);
    }

    /// @notice Stop reporting and withdraw the whole stake (after slashing and rewards). Needs zero open votes, so a
    ///         reporter cannot run from a pending slash. Also lets a removed reporter withdraw a leftover stake.
    function leave() external nonReentrant {
        if (openVotes[msg.sender] != 0) revert HasOpenVotes();
        uint256 stake = stakeOf[msg.sender];
        if (!_revokeRole(REPORTER_ROLE, msg.sender) && stake == 0) revert NotReporter();
        stakeOf[msg.sender] = 0;
        if (stake != 0) vlad.safeTransfer(msg.sender, stake);
        emit ReporterLeft(msg.sender, stake);
    }

    /// @notice Admin adds a reporter without a stake (such a reporter has nothing to lose to slashing).
    function addReporter(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_grantRole(REPORTER_ROLE, account)) revert AlreadyReporter();
        emit ReporterAdded(account);
    }

    /// @notice Admin removes a reporter; any stake stays withdrawable through `leave` once its open votes finalize.
    function removeReporter(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!_revokeRole(REPORTER_ROLE, account)) revert NotReporter();
        emit ReporterRemoved(account);
    }

    // ------------------------------------------------------------------ questions

    /// @notice ASKER_ROLE holders (StellarPredict) ask for free; reporters pay `questionFee` VLAD to `sink`.
    function createQuestion(string calldata text, string[] calldata options, uint64 votingStart, uint64 votingEnd)
        external
        nonReentrant
        returns (uint256 qid)
    {
        bool asker = hasRole(ASKER_ROLE, msg.sender);
        if (!asker && !hasRole(REPORTER_ROLE, msg.sender)) revert NotReporter();
        if (options.length < 2 || options.length > MAX_OPTIONS) revert BadOptions();
        // Windows are hours to days long; a validator's few seconds of timestamp drift do not matter here.
        // forge-lint: disable-next-line(block-timestamp)
        if (votingEnd <= votingStart || votingEnd <= block.timestamp) revert BadWindow();
        qid = _questions.length;
        Question storage q = _questions.push();
        q.text = text;
        for (uint256 i; i < options.length; ++i) {
            q.options.push(options[i]);
        }
        (q.asker, q.votingStart, q.votingEnd) = (msg.sender, votingStart, votingEnd);
        if (!asker && questionFee != 0) vlad.safeTransferFrom(msg.sender, sink, questionFee);
        emit QuestionCreated(qid, msg.sender, text, votingStart, votingEnd);
    }

    /// @notice One vote per reporter per question, inside [votingStart, votingEnd] (both inclusive).
    function vote(uint256 qid, uint8 option) external {
        if (!hasRole(REPORTER_ROLE, msg.sender)) revert NotReporter();
        Question storage q = _question(qid);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < q.votingStart) revert VotingNotOpen();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > q.votingEnd) revert VotingClosed();
        if (option >= q.options.length) revert BadOption();
        if (_choice[qid][msg.sender] != 0) revert AlreadyVoted();
        // Reachable only if the admin removes reporters who already voted and new ones join; keeps `finalize` bounded.
        if (q.voters.length >= MAX_REPORTERS) revert TooManyReporters();
        _choice[qid][msg.sender] = option + 1;
        q.votes[option]++;
        q.voters.push(msg.sender);
        openVotes[msg.sender]++;
        emit Voted(qid, msg.sender, option);
    }

    /// @notice Anyone, after votingEnd: plurality wins, a tie for first or zero votes is INVALID (no slashing then).
    function finalize(uint256 qid) external nonReentrant {
        Question storage q = _question(qid);
        if (q.finalized) revert AlreadyFinalized();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= q.votingEnd) revert NotFinalizable();
        uint8 winner = INVALID;
        uint256 best;
        for (uint256 i; i < q.options.length; ++i) {
            uint256 v = q.votes[i];
            // forge-lint: disable-next-line(unsafe-typecast)
            if (v > best) (best, winner) = (v, uint8(i)); // i < 8
            else if (v == best) winner = INVALID; // a later, higher count clears the tie again
        }
        q.finalized = true;
        q.winner = winner;

        address[] storage voters = q.voters;
        uint256 pot;
        for (uint256 i; i < voters.length; ++i) {
            address r = voters[i];
            openVotes[r]--;
            if (winner != INVALID && _choice[qid][r] != winner + 1) {
                uint256 cut = stakeOf[r] * slashBps / 1e4;
                if (cut != 0) {
                    stakeOf[r] -= cut;
                    pot += cut;
                    emit Slashed(qid, r, cut);
                }
            }
        }
        if (pot != 0) {
            uint256 share = pot / best; // best = number of majority voters (>= 1 because winner is valid)
            for (uint256 i; i < voters.length; ++i) {
                address r = voters[i];
                if (_choice[qid][r] == winner + 1) {
                    stakeOf[r] += share;
                    emit Rewarded(qid, r, share);
                }
            }
            uint256 dust = pot - share * best; // < best wei of rounding
            if (dust != 0) vlad.safeTransfer(sink, dust);
        }
        emit Finalized(qid, winner, _votes(q));
    }

    // ------------------------------------------------------------------ views

    function result(uint256 qid) external view returns (bool finalized, uint8 winner) {
        Question storage q = _question(qid);
        return (q.finalized, q.winner);
    }

    function question(uint256 qid) external view returns (QuestionView memory v) {
        Question storage q = _question(qid);
        (v.text, v.options, v.votes, v.asker) = (q.text, q.options, _votes(q), q.asker);
        (v.votingStart, v.votingEnd, v.finalized, v.winner) = (q.votingStart, q.votingEnd, q.finalized, q.winner);
        v.voterCount = q.voters.length;
    }

    function questionCount() external view returns (uint256) {
        return _questions.length;
    }

    function reporters() external view returns (address[] memory) {
        return _reporters;
    }

    function hasVoted(uint256 qid, address reporter) external view returns (bool) {
        return _choice[qid][reporter] != 0;
    }

    // ------------------------------------------------------------------ internals

    function _question(uint256 qid) internal view returns (Question storage) {
        if (qid >= _questions.length) revert UnknownQuestion();
        return _questions[qid];
    }

    function _votes(Question storage q) internal view returns (uint32[] memory out) {
        out = new uint32[](q.options.length);
        for (uint256 i; i < out.length; ++i) {
            out[i] = q.votes[i];
        }
    }

    /// @dev Keeps `_reporters` in sync with REPORTER_ROLE however the role changes (join, admin, grant, renounce).
    function _grantRole(bytes32 role, address account) internal override returns (bool granted) {
        granted = super._grantRole(role, account);
        if (granted && role == REPORTER_ROLE) {
            if (_reporters.length >= MAX_REPORTERS) revert TooManyReporters();
            _reporters.push(account);
            _reporterSlot[account] = _reporters.length;
        }
    }

    function _revokeRole(bytes32 role, address account) internal override returns (bool revoked) {
        revoked = super._revokeRole(role, account);
        if (revoked && role == REPORTER_ROLE) {
            uint256 i = _reporterSlot[account] - 1;
            address last = _reporters[_reporters.length - 1];
            _reporters[i] = last;
            _reporterSlot[last] = i + 1;
            _reporters.pop();
            delete _reporterSlot[account];
        }
    }
}
