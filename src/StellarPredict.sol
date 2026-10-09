// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStellarOracle} from "./interfaces/IStellarOracle.sol";
import {IStellarPredict} from "./interfaces/IStellarPredict.sol";

/// @title StellarPredict - a parimutuel prediction market on real-world questions, answered by StellarOracle.
/// @notice A creator opens a market; the same transaction asks the oracle, whose voting starts at `closeTime`.
///         Anyone bets VLAD on an option while block.timestamp < closeTime. After the oracle finalizes, anyone calls
///         `resolve`: `feeBps` of the whole pool goes to `sink` (the Arena prize pool), and each winner later claims
///         stake x (totalPool - fee) / winningPool. If the oracle answer is INVALID, or nobody bet on the winning
///         option, the market is voided and every bettor claims back exactly what they bet (no fee).
contract StellarPredict is IStellarPredict, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant CREATOR_ROLE = keccak256("CREATOR_ROLE");
    uint256 public constant CREATOR_FEE = 50e18; // `applyAsCreator` price, sent to `sink`
    uint256 public constant MAX_FEE_BPS = 1000;

    IERC20 public immutable vlad;
    IStellarOracle public immutable oracle;
    address public immutable sink;
    uint256 public immutable feeBps;

    /// @dev The question text and options live in the oracle only (read back by `market`), to store them once.
    struct Market {
        address creator;
        uint64 closeTime;
        uint8 optionCount;
        State state; // OPEN, RESOLVED or VOIDED
        uint8 winner;
        uint256 oracleQid;
        uint256 totalPool;
        uint256 fee;
        uint256[8] pools;
    }

    Market[] internal _markets;
    mapping(uint256 => mapping(address => uint256[8])) internal _stakes;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event CreatorApplied(address indexed creator, uint256 fee);
    event MarketCreated(uint256 indexed id, uint256 indexed oracleQid, address indexed creator, uint64 closeTime);
    event BetPlaced(uint256 indexed id, address indexed user, uint8 option, uint256 amount);
    event MarketResolved(uint256 indexed id, uint8 winner, uint256 fee);
    event MarketVoided(uint256 indexed id, uint8 oracleAnswer);
    event Claimed(uint256 indexed id, address indexed user, uint256 amount);

    error NotCreator();
    error AlreadyCreator();
    error UnknownMarket();
    error BadTimes();
    error BadOption();
    error ZeroAmount();
    error MarketClosed();
    error MarketOpen();
    error OracleNotFinal();
    error AlreadyResolved();
    error NotResolved();
    error AlreadyClaimed();
    error NothingToClaim();
    error BadParams();

    constructor(IERC20 vlad_, IStellarOracle oracle_, address sink_, uint256 feeBps_) {
        if (feeBps_ > MAX_FEE_BPS || sink_ == address(0)) revert BadParams();
        (vlad, oracle, sink, feeBps) = (vlad_, oracle_, sink_, feeBps_);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Pay CREATOR_FEE VLAD to the Arena prize pool and get CREATOR_ROLE.
    function applyAsCreator() external nonReentrant {
        if (!_grantRole(CREATOR_ROLE, msg.sender)) revert AlreadyCreator();
        vlad.safeTransferFrom(msg.sender, sink, CREATOR_FEE);
        emit CreatorApplied(msg.sender, CREATOR_FEE);
    }

    /// @notice Opens a market and its oracle question (voting from closeTime to closeTime + resolveWindow).
    ///         The oracle checks the options (2 to 8); this contract needs the oracle's ASKER_ROLE.
    function createMarket(string calldata question, string[] calldata options, uint64 closeTime, uint64 resolveWindow)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (!hasRole(CREATOR_ROLE, msg.sender)) revert NotCreator();
        // forge-lint: disable-next-line(block-timestamp)
        if (closeTime <= block.timestamp || resolveWindow == 0) revert BadTimes();
        uint256 qid = oracle.createQuestion(question, options, closeTime, closeTime + resolveWindow);
        id = _markets.length;
        Market storage m = _markets.push();
        // forge-lint: disable-next-line(unsafe-typecast)
        (m.creator, m.closeTime, m.optionCount, m.oracleQid) = (msg.sender, closeTime, uint8(options.length), qid);
        emit MarketCreated(id, qid, msg.sender, closeTime);
    }

    /// @notice Bet `amount` VLAD on `option`. Bets are final (no cancel) and allowed while block.timestamp < closeTime.
    function bet(uint256 id, uint8 option, uint256 amount) external nonReentrant {
        Market storage m = _market(id);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= m.closeTime) revert MarketClosed();
        if (option >= m.optionCount) revert BadOption();
        if (amount == 0) revert ZeroAmount();
        m.pools[option] += amount;
        m.totalPool += amount;
        _stakes[id][msg.sender][option] += amount;
        vlad.safeTransferFrom(msg.sender, address(this), amount);
        emit BetPlaced(id, msg.sender, option, amount);
    }

    /// @notice Anyone, once the oracle question is finalized: settles the market and sends the fee to `sink`.
    function resolve(uint256 id) external nonReentrant {
        Market storage m = _market(id);
        if (m.state != State.OPEN) revert AlreadyResolved();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < m.closeTime) revert MarketOpen();
        (bool finalized, uint8 winner) = oracle.result(m.oracleQid);
        if (!finalized) revert OracleNotFinal();
        m.winner = winner;
        if (winner >= m.optionCount || m.pools[winner] == 0) {
            m.state = State.VOIDED; // INVALID answer, or no winner to pay: everyone gets their bets back
            emit MarketVoided(id, winner);
        } else {
            uint256 fee = m.totalPool * feeBps / 1e4;
            (m.state, m.fee) = (State.RESOLVED, fee);
            if (fee != 0) vlad.safeTransfer(sink, fee);
            emit MarketResolved(id, winner, fee);
        }
    }

    /// @notice Winners: stake x (totalPool - fee) / winningPool. Voided market: all of your bets back. Once per market.
    function claim(uint256 id) external nonReentrant returns (uint256 amount) {
        Market storage m = _market(id);
        if (m.state == State.OPEN) revert NotResolved();
        if (claimed[id][msg.sender]) revert AlreadyClaimed();
        amount = _payout(m, _stakes[id][msg.sender]);
        if (amount == 0) revert NothingToClaim();
        claimed[id][msg.sender] = true;
        vlad.safeTransfer(msg.sender, amount);
        emit Claimed(id, msg.sender, amount);
    }

    // ------------------------------------------------------------------ views

    function market(uint256 id) external view returns (MarketView memory v) {
        Market storage m = _market(id);
        IStellarOracle.QuestionView memory q = oracle.question(m.oracleQid);
        (v.question, v.options, v.closeTime, v.votingEnd) = (q.text, q.options, m.closeTime, q.votingEnd);
        (v.oracleQid, v.pools, v.totalPool, v.fee) = (m.oracleQid, _list(m.pools, m.optionCount), m.totalPool, m.fee);
        (v.state, v.winner, v.creator) = (m.state, m.winner, m.creator);
        // forge-lint: disable-next-line(block-timestamp)
        if (m.state == State.OPEN && block.timestamp >= m.closeTime) v.state = State.CLOSED;
    }

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function positionOf(uint256 id, address user) external view returns (uint256[] memory) {
        return _list(_stakes[id][user], _market(id).optionCount);
    }

    /// @notice Each option's share of the pool in basis points (an even split while the pool is empty).
    function impliedOdds(uint256 id) external view returns (uint256[] memory bps) {
        Market storage m = _market(id);
        bps = new uint256[](m.optionCount);
        for (uint256 i; i < bps.length; ++i) {
            bps[i] = m.totalPool == 0 ? 1e4 / bps.length : m.pools[i] * 1e4 / m.totalPool;
        }
    }

    function claimableOf(uint256 id, address user) external view returns (uint256) {
        return claimed[id][user] ? 0 : _payout(_market(id), _stakes[id][user]);
    }

    // ------------------------------------------------------------------ internals

    function _market(uint256 id) internal view returns (Market storage) {
        if (id >= _markets.length) revert UnknownMarket();
        return _markets[id];
    }

    function _payout(Market storage m, uint256[8] storage s) internal view returns (uint256 amount) {
        if (m.state == State.RESOLVED) return s[m.winner] * (m.totalPool - m.fee) / m.pools[m.winner];
        if (m.state == State.VOIDED) {
            for (uint256 i; i < m.optionCount; ++i) {
                amount += s[i];
            }
        }
    }

    function _list(uint256[8] storage a, uint256 n) internal view returns (uint256[] memory out) {
        out = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = a[i];
        }
    }
}
