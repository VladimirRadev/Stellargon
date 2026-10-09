// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal surface of StellarOracle (human voting oracle) for the web app and sibling contracts.
interface IStellarOracle {
    struct QuestionView {
        string text;
        string[] options;
        uint32[] votes; // votes per option, same order as `options`
        address asker;
        uint64 votingStart; // unix seconds, inclusive
        uint64 votingEnd; // unix seconds, inclusive; `finalize` works from votingEnd + 1
        bool finalized;
        uint8 winner; // option index, or INVALID (255) on a tie or zero votes; meaningless until finalized
        uint256 voterCount;
    }

    function INVALID() external view returns (uint8);
    function ASKER_ROLE() external view returns (bytes32);
    function REPORTER_ROLE() external view returns (bytes32);
    function reporterStake() external view returns (uint256);
    function questionFee() external view returns (uint256);
    function slashBps() external view returns (uint256);
    function sink() external view returns (address);

    function joinAsReporter() external;
    function leave() external;
    function createQuestion(string calldata text, string[] calldata options, uint64 votingStart, uint64 votingEnd)
        external
        returns (uint256 qid);
    function vote(uint256 qid, uint8 option) external;
    function finalize(uint256 qid) external;

    function result(uint256 qid) external view returns (bool finalized, uint8 winner);
    function question(uint256 qid) external view returns (QuestionView memory);
    function questionCount() external view returns (uint256);
    function reporters() external view returns (address[] memory);
    function hasVoted(uint256 qid, address reporter) external view returns (bool);
    function stakeOf(address reporter) external view returns (uint256);
    function openVotes(address reporter) external view returns (uint256);
}
