// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StellarOracle} from "../src/StellarOracle.sol";
import {StellarPredict} from "../src/StellarPredict.sol";
import {IStellarOracle} from "../src/interfaces/IStellarOracle.sol";
import {IStellarPredict} from "../src/interfaces/IStellarPredict.sol";
import {MockVlad} from "./mocks/MockVlad.sol";

contract StellarPredictTest is Test {
    MockVlad vlad;
    StellarOracle oracle;
    StellarPredict predict;

    address sink = makeAddr("arena prize pool");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address stranger = makeAddr("stranger");
    address[3] rep;

    uint256 constant FEE_BPS = 200; // 2%
    uint64 constant NOW = 1_000_000;
    uint64 constant CLOSE = NOW + 7 days;
    uint64 constant WINDOW = 3 days;
    uint8 constant YES = 0;
    uint8 constant NO = 1;

    function setUp() public {
        vm.warp(NOW);
        vlad = new MockVlad();
        oracle = new StellarOracle(IERC20(address(vlad)), 100e18, 10e18, 1000, sink);
        predict = new StellarPredict(IERC20(address(vlad)), IStellarOracle(address(oracle)), sink, FEE_BPS);
        oracle.grantRole(oracle.ASKER_ROLE(), address(predict));
        predict.grantRole(predict.CREATOR_ROLE(), creator);

        address[4] memory users = [alice, bob, carol, stranger];
        for (uint256 i; i < users.length; ++i) {
            vlad.mint(users[i], 1000e18);
            vm.prank(users[i]);
            vlad.approve(address(predict), type(uint256).max);
        }
        for (uint256 i; i < rep.length; ++i) {
            rep[i] = makeAddr(string.concat("reporter", vm.toString(i)));
            oracle.addReporter(rep[i]);
        }
    }

    // ------------------------------------------------------------------ helpers

    function _opts(uint256 n) internal pure returns (string[] memory o) {
        o = new string[](n);
        if (n == 2) {
            (o[0], o[1]) = ("Yes", "No");
            return o;
        }
        for (uint256 i; i < n; ++i) {
            o[i] = string.concat("option ", vm.toString(i));
        }
    }

    function _create(uint256 optionCount) internal returns (uint256 id) {
        vm.prank(creator);
        id = predict.createMarket("Will ETH close above $2,500?", _opts(optionCount), CLOSE, WINDOW);
    }

    function _bet(address user, uint256 id, uint8 option, uint256 amount) internal {
        vm.prank(user);
        predict.bet(id, option, amount);
    }

    /// Reporters vote `answers` (one per reporter, in order) and the question is finalized after the window.
    function _settle(uint256 id, uint8[] memory answers) internal {
        uint256 qid = predict.market(id).oracleQid;
        vm.warp(CLOSE);
        for (uint256 i; i < answers.length; ++i) {
            vm.prank(rep[i]);
            oracle.vote(qid, answers[i]);
        }
        vm.warp(CLOSE + WINDOW + 1);
        oracle.finalize(qid);
    }

    function _answers(uint8 a, uint8 b, uint8 c) internal pure returns (uint8[] memory x) {
        x = new uint8[](3);
        (x[0], x[1], x[2]) = (a, b, c);
    }

    // ------------------------------------------------------------------ create

    function test_CreateMarket_CreatorRoleAndApplyFee() public {
        vm.prank(stranger);
        vm.expectRevert(StellarPredict.NotCreator.selector);
        predict.createMarket("q", _opts(2), CLOSE, WINDOW);

        // Anyone can buy the creator role for 50 VLAD, paid to the Arena prize pool.
        uint256 before = vlad.balanceOf(stranger);
        vm.prank(stranger);
        predict.applyAsCreator();
        assertTrue(predict.hasRole(predict.CREATOR_ROLE(), stranger));
        assertEq(vlad.balanceOf(sink), 50e18);
        assertEq(vlad.balanceOf(stranger), before - 50e18);
        vm.prank(stranger);
        vm.expectRevert(StellarPredict.AlreadyCreator.selector);
        predict.applyAsCreator();

        vm.prank(stranger);
        uint256 id = predict.createMarket("Will it rain?", _opts(3), CLOSE, WINDOW);
        assertEq(id, 0);
        assertEq(predict.marketCount(), 1);

        // The market's oracle question votes from closeTime to closeTime + resolveWindow, free of the question fee.
        IStellarPredict.MarketView memory m = predict.market(id);
        IStellarOracle.QuestionView memory q = oracle.question(m.oracleQid);
        assertEq(m.question, "Will it rain?");
        assertEq(m.options.length, 3);
        assertEq(m.closeTime, CLOSE);
        assertEq(m.votingEnd, CLOSE + WINDOW);
        assertEq(q.votingStart, CLOSE);
        assertEq(q.asker, address(predict));
        assertEq(uint8(m.state), uint8(IStellarPredict.State.OPEN));
        assertEq(m.creator, stranger);
        assertEq(vlad.balanceOf(sink), 50e18);

        vm.prank(creator);
        vm.expectRevert(StellarPredict.BadTimes.selector);
        predict.createMarket("q", _opts(2), NOW, WINDOW);
        vm.prank(creator);
        vm.expectRevert(StellarOracle.BadOptions.selector);
        predict.createMarket("q", _opts(1), CLOSE, WINDOW);
    }

    // ------------------------------------------------------------------ bet

    function test_BetBeforeClose_AfterCloseReverts() public {
        uint256 id = _create(2);
        _bet(alice, id, YES, 30e18);
        _bet(alice, id, NO, 5e18);
        _bet(bob, id, NO, 15e18);

        IStellarPredict.MarketView memory m = predict.market(id);
        assertEq(m.pools[YES], 30e18);
        assertEq(m.pools[NO], 20e18);
        assertEq(m.totalPool, 50e18);
        uint256[] memory pos = predict.positionOf(id, alice);
        assertEq(pos[YES], 30e18);
        assertEq(pos[NO], 5e18);
        assertEq(vlad.balanceOf(address(predict)), 50e18);

        vm.prank(alice);
        vm.expectRevert(StellarPredict.BadOption.selector);
        predict.bet(id, 2, 1e18);
        vm.prank(alice);
        vm.expectRevert(StellarPredict.ZeroAmount.selector);
        predict.bet(id, YES, 0);

        vm.warp(CLOSE - 1);
        _bet(carol, id, YES, 1e18); // last second is still open
        vm.warp(CLOSE);
        assertEq(uint8(predict.market(id).state), uint8(IStellarPredict.State.CLOSED));
        vm.prank(carol);
        vm.expectRevert(StellarPredict.MarketClosed.selector);
        predict.bet(id, YES, 1e18);
    }

    // ------------------------------------------------------------------ resolve / claim

    function test_ResolveRequiresFinalizedOracle() public {
        uint256 id = _create(2);
        _bet(alice, id, YES, 10e18);

        vm.expectRevert(StellarPredict.MarketOpen.selector);
        predict.resolve(id);
        vm.prank(alice);
        vm.expectRevert(StellarPredict.NotResolved.selector);
        predict.claim(id);

        uint256 qid = predict.market(id).oracleQid;
        vm.warp(CLOSE);
        vm.prank(rep[0]);
        oracle.vote(qid, YES);
        vm.expectRevert(StellarPredict.OracleNotFinal.selector);
        predict.resolve(id);
        vm.warp(CLOSE + WINDOW + 1); // voting is over but nobody has finalized yet
        vm.expectRevert(StellarPredict.OracleNotFinal.selector);
        predict.resolve(id);

        oracle.finalize(qid);
        predict.resolve(id);
        assertEq(uint8(predict.market(id).state), uint8(IStellarPredict.State.RESOLVED));
        vm.expectRevert(StellarPredict.AlreadyResolved.selector);
        predict.resolve(id);
    }

    /// Pool 100 VLAD: alice 30 + bob 10 on YES, carol 60 on NO. Fee 2% = 2 VLAD to the sink. YES wins, so the 98 VLAD
    /// left are split by YES stake: alice 30 * 98 / 40 = 73.5, bob 10 * 98 / 40 = 24.5, carol nothing.
    function test_WinnersClaimProRataMinusFee() public {
        uint256 id = _create(2);
        _bet(alice, id, YES, 30e18);
        _bet(bob, id, YES, 10e18);
        _bet(carol, id, NO, 60e18);
        _settle(id, _answers(YES, YES, NO));

        predict.resolve(id);
        IStellarPredict.MarketView memory m = predict.market(id);
        assertEq(m.winner, YES);
        assertEq(m.fee, 2e18);
        assertEq(vlad.balanceOf(sink), 2e18);
        assertEq(predict.claimableOf(id, alice), 73.5e18);
        assertEq(predict.claimableOf(id, carol), 0);

        uint256 a0 = vlad.balanceOf(alice);
        uint256 b0 = vlad.balanceOf(bob);
        vm.prank(alice);
        assertEq(predict.claim(id), 73.5e18);
        vm.prank(bob);
        predict.claim(id);
        assertEq(vlad.balanceOf(alice) - a0, 73.5e18);
        assertEq(vlad.balanceOf(bob) - b0, 24.5e18);
        assertEq(vlad.balanceOf(address(predict)), 0); // everything paid out, no dust here
        vm.prank(carol);
        vm.expectRevert(StellarPredict.NothingToClaim.selector);
        predict.claim(id);
    }

    function test_InvalidOracleAnswerVoidsAndRefunds() public {
        uint256 id = _create(3);
        _bet(alice, id, 0, 30e18);
        _bet(alice, id, 2, 5e18);
        _bet(bob, id, 1, 10e18);
        _settle(id, _answers(0, 1, 2)); // three-way tie: INVALID

        vm.expectEmit(address(predict));
        emit StellarPredict.MarketVoided(id, 255);
        predict.resolve(id);
        IStellarPredict.MarketView memory m = predict.market(id);
        assertEq(uint8(m.state), uint8(IStellarPredict.State.VOIDED));
        assertEq(m.fee, 0);
        assertEq(vlad.balanceOf(sink), 0); // no fee on a voided market

        uint256 a0 = vlad.balanceOf(alice);
        vm.prank(alice);
        predict.claim(id);
        vm.prank(bob);
        predict.claim(id);
        assertEq(vlad.balanceOf(alice) - a0, 35e18); // both of alice's bets back
        assertEq(vlad.balanceOf(bob), 1000e18);
        assertEq(vlad.balanceOf(address(predict)), 0);
    }

    function test_NoBetsOnWinnerVoidsAndRefunds() public {
        uint256 id = _create(2);
        _bet(alice, id, NO, 20e18);
        _settle(id, _answers(YES, YES, YES));
        predict.resolve(id);
        assertEq(uint8(predict.market(id).state), uint8(IStellarPredict.State.VOIDED));
        vm.prank(alice);
        assertEq(predict.claim(id), 20e18);
    }

    function test_DoubleClaimReverts() public {
        uint256 id = _create(2);
        _bet(alice, id, YES, 10e18);
        _bet(bob, id, NO, 10e18);
        _settle(id, _answers(YES, YES, YES));
        predict.resolve(id);

        vm.startPrank(alice);
        assertEq(predict.claim(id), 19.6e18); // 20 VLAD pool minus the 2% fee
        assertTrue(predict.claimed(id, alice));
        assertEq(predict.claimableOf(id, alice), 0);
        vm.expectRevert(StellarPredict.AlreadyClaimed.selector);
        predict.claim(id);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ odds

    function test_ImpliedOdds() public {
        uint256 id = _create(2);
        uint256[] memory odds = predict.impliedOdds(id);
        assertEq(odds[YES], 5000); // empty pool: even split
        assertEq(odds[NO], 5000);

        _bet(alice, id, YES, 25e18);
        _bet(bob, id, NO, 75e18);
        odds = predict.impliedOdds(id);
        assertEq(odds[YES], 2500);
        assertEq(odds[NO], 7500);

        uint256 three = _create(3);
        odds = predict.impliedOdds(three);
        assertEq(odds.length, 3);
        assertEq(odds[0] + odds[1] + odds[2], 9999); // 3333 each, rounded down
        _bet(carol, three, 2, 1e18);
        odds = predict.impliedOdds(three);
        assertEq(odds[2], 10_000);
        assertEq(odds[0], 0);
    }
}
