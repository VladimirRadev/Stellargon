// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {StellarOracle} from "../src/StellarOracle.sol";
import {StellarPredict} from "../src/StellarPredict.sol";
import {IStellarOracle} from "../src/interfaces/IStellarOracle.sol";
import {IVladToken} from "../src/interfaces/IVladToken.sol";

/// @notice Deploys StellarOracle + StellarPredict against the already-deployed $VLAD token, wires them together and
///         opens 3 seed markets that close 7 days after deployment.
/// Env: PRIVATE_KEY (deployer, becomes admin of both contracts), VLAD_TOKEN, FEE_SINK (the Arena prize pool, which
///      receives question fees, creator application fees and the 2% market fee); optional ETH_STRIKE_USD (default 2500).
/// Run with --slow --skip-simulation (Sepolia prices contract creation above the local simulation; the EIP-7702
/// delegated deployer allows one in-flight tx, so on "in-flight transaction limit" wait ~20 s and rerun with --resume).
/// Transactions, in order: (1) create oracle, (2) create predict, (3) oracle.grantRole(ASKER_ROLE, predict),
/// (4) predict.grantRole(CREATOR_ROLE, deployer), (5)-(7) predict.createMarket x 3.
contract Deploy is Script {
    uint256 constant REPORTER_STAKE = 100e18; // VLAD locked by `joinAsReporter`
    uint256 constant QUESTION_FEE = 10e18; // VLAD a reporter pays per question (ASKER_ROLE asks for free)
    uint256 constant SLASH_BPS = 1000; // 10% of a minority voter's stake
    uint256 constant MARKET_FEE_BPS = 200; // 2% of each resolved pool
    uint64 constant BETTING_TIME = 7 days;
    uint64 constant RESOLVE_WINDOW = 3 days; // reporters vote from closeTime to closeTime + 3 days
    uint256 constant BLOCKS_PER_7_DAYS = 50_400; // 12 s slots
    uint256 constant BLOCK_MARGIN = 300; // ~1 hour, so block N is mined after betting closes

    function run() external returns (StellarOracle oracle, StellarPredict predict) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        IVladToken vlad = IVladToken(vm.envAddress("VLAD_TOKEN"));
        address sink = vm.envAddress("FEE_SINK");
        uint256 strike = vm.envOr("ETH_STRIKE_USD", uint256(2500));
        require(address(vlad).code.length > 0, "VLAD_TOKEN has no code");
        require(sink.code.length > 0, "FEE_SINK has no code (expected the Arena contract)");

        uint64 closeTime = uint64(block.timestamp) + BETTING_TIME;
        string memory today = _date(block.timestamp);
        string memory closeDay = _date(closeTime);
        string memory blockN = vm.toString(block.number + BLOCKS_PER_7_DAYS + BLOCK_MARGIN);
        string[] memory yesNo = new string[](2);
        (yesNo[0], yesNo[1]) = ("Yes", "No");

        vm.startBroadcast(pk);
        oracle = new StellarOracle(vlad, REPORTER_STAKE, QUESTION_FEE, SLASH_BPS, sink); // (1)
        predict = new StellarPredict(vlad, IStellarOracle(address(oracle)), sink, MARKET_FEE_BPS); // (2)
        oracle.grantRole(oracle.ASKER_ROLE(), address(predict)); // (3) predict asks the oracle for free
        predict.grantRole(predict.CREATOR_ROLE(), deployer); // (4)
        predict.createMarket( // (5)
            string.concat(
                "Will ETH/USD close above $",
                _thousands(strike),
                " on ",
                closeDay,
                " (UTC)? Source: CoinGecko Ethereum historical data, the Close column for ",
                closeDay,
                " (coingecko.com/en/coins/ethereum/historical_data)."
            ),
            yesNo,
            closeTime,
            RESOLVE_WINDOW
        );
        predict.createMarket( // (6)
            string.concat(
                "Will Bitcoin's 7-day average hashrate on ",
                closeDay,
                " be higher than on ",
                today,
                "? Source: blockchain.com/explorer/charts/hash-rate with the 7-day average."
            ),
            yesNo,
            closeTime,
            RESOLVE_WINDOW
        );
        predict.createMarket( // (7)
            string.concat(
                "Will the Sepolia base fee of block ",
                blockN,
                " be above 1 gwei? Source: baseFeePerGas of block ",
                blockN,
                " on eth-sepolia.blockscout.com/block/",
                blockN,
                "."
            ),
            yesNo,
            closeTime,
            RESOLVE_WINDOW
        );
        vm.stopBroadcast();

        console2.log("StellarOracle :", address(oracle));
        console2.log("StellarPredict:", address(predict));
        console2.log("Seed markets close at (unix):", closeTime);
    }

    /// @dev Unix seconds -> "YYYY-MM-DD" (UTC), H. Hinnant's days-to-civil algorithm.
    function _date(uint256 ts) internal pure returns (string memory) {
        uint256 z = ts / 1 days + 719_468;
        uint256 era = z / 146_097;
        uint256 doe = z - era * 146_097;
        uint256 yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 d = doy - (153 * mp + 2) / 5 + 1;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        uint256 y = yoe + era * 400 + (m <= 2 ? 1 : 0);
        return string.concat(vm.toString(y), "-", _pad(m, 2), "-", _pad(d, 2));
    }

    /// @dev 2500 -> "2,500" (values below one million).
    function _thousands(uint256 v) internal pure returns (string memory) {
        return v < 1000 ? vm.toString(v) : string.concat(vm.toString(v / 1000), ",", _pad(v % 1000, 3));
    }

    function _pad(uint256 v, uint256 width) internal pure returns (string memory s) {
        s = vm.toString(v);
        while (bytes(s).length < width) {
            s = string.concat("0", s);
        }
    }
}
