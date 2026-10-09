// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {StellarOracle} from "../src/StellarOracle.sol";
import {IStellarOracle} from "../src/interfaces/IStellarOracle.sol";
import {MockVlad} from "./mocks/MockVlad.sol";

contract StellarOracleTest is Test {
    MockVlad vlad;
    StellarOracle oracle;

    address sink = makeAddr("arena prize pool");
    address asker = makeAddr("asker (StellarPredict)");
    address stranger = makeAddr("stranger");
    address[5] rep;

    uint256 constant STAKE = 100e18;
    uint256 constant QFEE = 10e18;
    uint256 constant SLASH_BPS = 1000; // 10%
    uint64 constant START = 1_000_000;
    uint64 constant END = START + 1 days;

    function setUp() public {
        vm.warp(START - 1 hours);
        vlad = new MockVlad();
        oracle = new StellarOracle(IERC20(address(vlad)), STAKE, QFEE, SLASH_BPS, sink);
        oracle.grantRole(oracle.ASKER_ROLE(), asker);
        for (uint256 i; i < rep.length; ++i) {
            rep[i] = makeAddr(string.concat("reporter", vm.toString(i)));
            vlad.mint(rep[i], 1000e18);
            vm.prank(rep[i]);
            vlad.approve(address(oracle), type(uint256).max);
        }
    }

    // ------------------------------------------------------------------ helpers

    function _join(uint256 n) internal {
        for (uint256 i; i < n; ++i) {
            vm.prank(rep[i]);
            oracle.joinAsReporter();
        }
    }

    function _ask(uint256 optionCount) internal returns (uint256 qid) {
        string[] memory opts = new string[](optionCount);
        for (uint256 i; i < optionCount; ++i) {
            opts[i] = string.concat("option ", vm.toString(i));
        }
        vm.prank(asker);
        qid = oracle.createQuestion("Will it happen?", opts, START, END);
    }

    function _vote(uint256 qid, uint256 r, uint8 option) internal {
        vm.prank(rep[r]);
        oracle.vote(qid, option);
    }

    // ------------------------------------------------------------------ reporters

    function test_JoinLeaveAndAdminAddRemove() public {
        vm.prank(rep[0]);
        oracle.joinAsReporter();
        assertTrue(oracle.hasRole(oracle.REPORTER_ROLE(), rep[0]));
        assertEq(oracle.stakeOf(rep[0]), STAKE);
        assertEq(vlad.balanceOf(address(oracle)), STAKE);
        vm.prank(rep[0]);
        vm.expectRevert(StellarOracle.AlreadyReporter.selector);
        oracle.joinAsReporter();

        // Admin adds a reporter without a stake; only the admin may do so.
        bytes32 adminRole = oracle.DEFAULT_ADMIN_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, adminRole)
        );
        oracle.addReporter(rep[1]);
        oracle.addReporter(rep[1]);
        assertEq(oracle.stakeOf(rep[1]), 0);
        address[] memory list = oracle.reporters();
        assertEq(list.length, 2);
        assertEq(list[0], rep[0]);
        assertEq(list[1], rep[1]);

        // Leaving returns the full stake and drops the reporter from the list.
        uint256 before = vlad.balanceOf(rep[0]);
        vm.prank(rep[0]);
        oracle.leave();
        assertEq(vlad.balanceOf(rep[0]), before + STAKE);
        assertEq(oracle.stakeOf(rep[0]), 0);
        assertFalse(oracle.hasRole(oracle.REPORTER_ROLE(), rep[0]));
        vm.prank(rep[0]);
        vm.expectRevert(StellarOracle.NotReporter.selector);
        oracle.leave();

        oracle.removeReporter(rep[1]);
        assertEq(oracle.reporters().length, 0);
        vm.expectRevert(StellarOracle.NotReporter.selector);
        oracle.removeReporter(rep[1]);
    }

    function test_CreateQuestion_AskerFreeReporterPaysFee() public {
        _join(1);
        string[] memory opts = new string[](2);
        (opts[0], opts[1]) = ("Yes", "No");

        // ASKER_ROLE (StellarPredict) asks for free.
        vm.prank(asker);
        uint256 q0 = oracle.createQuestion("Asker question", opts, START, END);
        assertEq(vlad.balanceOf(sink), 0);

        // A reporter pays the question fee straight to the sink.
        uint256 before = vlad.balanceOf(rep[0]);
        vm.prank(rep[0]);
        uint256 q1 = oracle.createQuestion("Reporter question", opts, START, END);
        assertEq(q0, 0);
        assertEq(q1, 1);
        assertEq(oracle.questionCount(), 2);
        assertEq(vlad.balanceOf(sink), QFEE);
        assertEq(vlad.balanceOf(rep[0]), before - QFEE);

        IStellarOracle.QuestionView memory v = oracle.question(q1);
        assertEq(v.text, "Reporter question");
        assertEq(v.options.length, 2);
        assertEq(v.options[1], "No");
        assertEq(v.asker, rep[0]);
        assertEq(v.votingStart, START);
        assertEq(v.votingEnd, END);
        assertFalse(v.finalized);

        // Anyone else is rejected, and so are bad option counts and windows.
        vm.prank(stranger);
        vm.expectRevert(StellarOracle.NotReporter.selector);
        oracle.createQuestion("x", opts, START, END);
        string[] memory one = new string[](1);
        vm.prank(asker);
        vm.expectRevert(StellarOracle.BadOptions.selector);
        oracle.createQuestion("x", one, START, END);
        string[] memory nine = new string[](9);
        vm.prank(asker);
        vm.expectRevert(StellarOracle.BadOptions.selector);
        oracle.createQuestion("x", nine, START, END);
        vm.prank(asker);
        vm.expectRevert(StellarOracle.BadWindow.selector);
        oracle.createQuestion("x", opts, END, START);
    }

    // ------------------------------------------------------------------ voting

    function test_VoteWindowAndSingleVote() public {
        _join(2);
        uint256 qid = _ask(2);

        vm.prank(rep[0]);
        vm.expectRevert(StellarOracle.VotingNotOpen.selector);
        oracle.vote(qid, 0);

        vm.warp(START); // start is inclusive
        _vote(qid, 0, 1);
        assertTrue(oracle.hasVoted(qid, rep[0]));
        assertFalse(oracle.hasVoted(qid, rep[1]));
        assertEq(oracle.openVotes(rep[0]), 1);

        vm.prank(rep[0]);
        vm.expectRevert(StellarOracle.AlreadyVoted.selector);
        oracle.vote(qid, 0);
        vm.prank(stranger);
        vm.expectRevert(StellarOracle.NotReporter.selector);
        oracle.vote(qid, 0);
        vm.prank(rep[1]);
        vm.expectRevert(StellarOracle.BadOption.selector);
        oracle.vote(qid, 2);

        vm.warp(END); // end is inclusive, and finalize is not allowed yet
        _vote(qid, 1, 1);
        vm.expectRevert(StellarOracle.NotFinalizable.selector);
        oracle.finalize(qid);

        vm.warp(END + 1);
        vm.prank(rep[1]);
        vm.expectRevert(StellarOracle.VotingClosed.selector);
        oracle.vote(qid, 0);
        assertEq(oracle.question(qid).voterCount, 2);
    }

    // ------------------------------------------------------------------ finalize

    function test_FinalizePlurality() public {
        _join(4);
        uint256 qid = _ask(3);
        vm.warp(START);
        _vote(qid, 0, 2);
        _vote(qid, 1, 2);
        _vote(qid, 2, 0);
        _vote(qid, 3, 1);

        (bool fin,) = oracle.result(qid);
        assertFalse(fin);
        vm.warp(END + 1);
        uint32[] memory expected = new uint32[](3);
        (expected[0], expected[1], expected[2]) = (1, 1, 2);
        vm.expectEmit(address(oracle));
        emit StellarOracle.Finalized(qid, 2, expected);
        oracle.finalize(qid);

        uint8 winner;
        (fin, winner) = oracle.result(qid);
        assertTrue(fin);
        assertEq(winner, 2);
        uint32[] memory votes = oracle.question(qid).votes;
        assertEq(votes.length, 3);
        assertEq(uint256(votes[2]), 2);
        assertEq(oracle.openVotes(rep[0]), 0);

        vm.expectRevert(StellarOracle.AlreadyFinalized.selector);
        oracle.finalize(qid);
    }

    function test_TieAndZeroVotesAreInvalidWithoutSlashing() public {
        _join(4);
        uint256 tie = _ask(2);
        uint256 empty = _ask(2);
        vm.warp(START);
        _vote(tie, 0, 0);
        _vote(tie, 1, 0);
        _vote(tie, 2, 1);
        _vote(tie, 3, 1);

        vm.warp(END + 1);
        oracle.finalize(tie);
        oracle.finalize(empty);
        (bool f1, uint8 w1) = oracle.result(tie);
        (bool f2, uint8 w2) = oracle.result(empty);
        assertTrue(f1 && f2);
        assertEq(w1, oracle.INVALID());
        assertEq(w2, 255);
        for (uint256 i; i < 4; ++i) {
            assertEq(oracle.stakeOf(rep[i]), STAKE); // nobody is slashed on INVALID
        }
        assertEq(vlad.balanceOf(sink), 0);
    }

    /// 3 reporters vote with the majority, 2 against. Each minority stake loses 10% (10 VLAD), so the pot is 20 VLAD,
    /// split 3 ways: 6.666666666666666666 VLAD each, and the 2 wei of rounding go to the sink.
    function test_SlashingSplitMath() public {
        _join(5);
        uint256 qid = _ask(2);
        vm.warp(START);
        for (uint256 i; i < 3; ++i) {
            _vote(qid, i, 0);
        }
        _vote(qid, 3, 1);
        _vote(qid, 4, 1);

        vm.warp(END + 1);
        oracle.finalize(qid);

        uint256 cut = STAKE * SLASH_BPS / 10_000;
        uint256 pot = 2 * cut;
        uint256 share = pot / 3;
        assertEq(cut, 10e18);
        assertEq(share, 6_666_666_666_666_666_666);
        for (uint256 i; i < 3; ++i) {
            assertEq(oracle.stakeOf(rep[i]), STAKE + share);
        }
        assertEq(oracle.stakeOf(rep[3]), STAKE - cut);
        assertEq(oracle.stakeOf(rep[4]), STAKE - cut);
        assertEq(vlad.balanceOf(sink), pot - 3 * share); // 2 wei of rounding dust
        assertEq(vlad.balanceOf(sink), 2);

        // Conservation: every wei the oracle holds is backed by a stake.
        uint256 total;
        for (uint256 i; i < 5; ++i) {
            total += oracle.stakeOf(rep[i]);
        }
        assertEq(vlad.balanceOf(address(oracle)), total);
        assertEq(total + vlad.balanceOf(sink), 5 * STAKE);
    }

    function test_LeaveBlockedWithOpenVotes() public {
        _join(2);
        uint256 qid = _ask(2);
        vm.warp(START);
        _vote(qid, 0, 0);
        _vote(qid, 1, 1);

        vm.prank(rep[0]);
        vm.expectRevert(StellarOracle.HasOpenVotes.selector);
        oracle.leave();

        // Admin removal does not release the stake early either.
        oracle.removeReporter(rep[1]);
        vm.prank(rep[1]);
        vm.expectRevert(StellarOracle.HasOpenVotes.selector);
        oracle.leave();

        vm.warp(END + 1);
        oracle.finalize(qid); // 1 vs 1: INVALID, no slashing
        uint256 before = vlad.balanceOf(rep[1]);
        vm.prank(rep[1]);
        oracle.leave(); // a removed reporter withdraws the leftover stake
        assertEq(vlad.balanceOf(rep[1]), before + STAKE);
        vm.prank(rep[0]);
        oracle.leave();
        assertEq(vlad.balanceOf(address(oracle)), 0);
    }
}
