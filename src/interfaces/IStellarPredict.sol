// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal surface of StellarPredict (parimutuel prediction market) for the web app.
interface IStellarPredict {
    /// @dev CLOSED is never stored: `market` reports it for an OPEN market whose close time has passed.
    enum State {
        OPEN,
        CLOSED,
        RESOLVED,
        VOIDED
    }

    struct MarketView {
        string question;
        string[] options;
        uint64 closeTime; // betting allowed while block.timestamp < closeTime; oracle voting starts here
        uint64 votingEnd; // the oracle's voting end; `resolve` works once the oracle question is finalized
        uint256 oracleQid;
        uint256[] pools; // VLAD bet on each option
        uint256 totalPool;
        uint256 fee; // taken at resolve (feeBps of totalPool), 0 when voided
        State state;
        uint8 winner; // valid when RESOLVED (option index) or VOIDED (oracle answer, may be 255 = INVALID)
        address creator;
    }

    function CREATOR_ROLE() external view returns (bytes32);
    function CREATOR_FEE() external view returns (uint256);
    function feeBps() external view returns (uint256);
    function sink() external view returns (address);

    function applyAsCreator() external;
    function createMarket(string calldata question, string[] calldata options, uint64 closeTime, uint64 resolveWindow)
        external
        returns (uint256 id);
    function bet(uint256 id, uint8 option, uint256 amount) external;
    function resolve(uint256 id) external;
    function claim(uint256 id) external returns (uint256 amount);

    function market(uint256 id) external view returns (MarketView memory);
    function marketCount() external view returns (uint256);
    function positionOf(uint256 id, address user) external view returns (uint256[] memory);
    function impliedOdds(uint256 id) external view returns (uint256[] memory bps);
    function claimableOf(uint256 id, address user) external view returns (uint256);
}
