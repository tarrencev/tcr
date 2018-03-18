/* eslint-env mocha */
/* global assert contract artifacts */
const Registry = artifacts.require('Registry.sol');
const Token = artifacts.require('EIP20.sol');

const fs = require('fs');
const BN = require('bignumber.js');

const config = JSON.parse(fs.readFileSync('./conf/config.json'));
const paramConfig = config.paramDefaults;

const utils = require('../utils.js');

const bigTen = number => new BN(number.toString(10), 10);

contract('Registry', (accounts) => {
  describe('Function: claimVoterReward', () => {
    const [applicant, challenger, voterAlice] = accounts;
    const minDeposit = bigTen(paramConfig.minDeposit);

    it('should transfer the correct number of tokens once a challenge has been resolved', async () => {
      const registry = await Registry.deployed();
      const voting = await utils.getVoting();
      const token = Token.at(await registry.token.call());

      // Apply
      await utils.as(applicant, registry.apply, minDeposit, '');
      const aliceStartingBalance = await token.balanceOf.call(voterAlice);

      // Challenge
      const pollID = await utils.challengeAndGetPollID(applicant, challenger);

      // Alice is so committed
      await utils.commitVote(pollID, '0', 500, '420', voterAlice);
      await utils.increaseTime(paramConfig.commitStageLength + 1);

      // Alice is so revealing
      await utils.as(voterAlice, voting.revealVote, pollID, '0', '420');
      await utils.increaseTime(paramConfig.revealStageLength + 1);

      // Update status
      await utils.as(applicant, registry.updateStatus, applicant);

      // Alice claims reward
      const aliceVoterReward = await registry.voterReward(voterAlice, pollID, '420');
      await utils.as(voterAlice, registry.claimVoterReward, pollID, '420');

      // Alice withdraws her voting rights
      await utils.as(voterAlice, voting.withdrawVotingRights, '500');

      const aliceExpected = aliceStartingBalance.add(aliceVoterReward);
      const aliceFinalBalance = await token.balanceOf.call(voterAlice);

      assert.strictEqual(
        aliceFinalBalance.toString(10), aliceExpected.toString(10),
        'alice should have the same balance as she started',
      );
    });

    it('should revert if challenge does not exist', async () => {
      const registry = await Registry.deployed();
      await utils.addToWhitelist(applicant, minDeposit);

      try {
        const nonPollID = '666';
        await utils.as(voterAlice, registry.claimVoterReward, nonPollID, '420');
        assert(false, 'should not have been able to claimVoterReward for non-existant challengeID');
      } catch (err) {
        assert(utils.isEVMException(err), err.toString());
      }

      await registry.exit({ from: applicant });
    });

    it('should revert if provided salt is incorrect', async () => {
      const registry = await Registry.deployed();
      const voting = await utils.getVoting();
      const token = Token.at(await registry.token.call());

      const applicantStartingBalance = await token.balanceOf.call(applicant);
      const aliceStartBal = await token.balanceOf.call(voterAlice);
      await utils.addToWhitelist(applicant, minDeposit);

      const pollID = await utils.challengeAndGetPollID(applicant, challenger);

      // Alice is so committed
      await utils.commitVote(pollID, '0', 500, '420', voterAlice);
      await utils.increaseTime(paramConfig.commitStageLength + 1);

      // Alice is so revealing
      await utils.as(voterAlice, voting.revealVote, pollID, '0', '420');
      await utils.increaseTime(paramConfig.revealStageLength + 1);

      const applicantFinalBalance = await token.balanceOf.call(applicant);
      const aliceFinalBalance = await token.balanceOf.call(voterAlice);
      const expectedBalance = applicantStartingBalance.sub(minDeposit);

      assert.strictEqual(
        applicantFinalBalance.toString(10), expectedBalance.toString(10),
        'applicants final balance should be what they started with minus the minDeposit',
      );
      assert.strictEqual(
        aliceFinalBalance.toString(10), (aliceStartBal.sub(bigTen(500))).toString(10),
        'alices final balance should be exactly the same as her starting balance',
      );

      // Update status
      await utils.as(applicant, registry.updateStatus, applicant);

      try {
        await utils.as(voterAlice, registry.claimVoterReward, pollID, '421');
        assert(false, 'should not have been able to claimVoterReward with the wrong salt');
      } catch (err) {
        assert(utils.isEVMException(err), err.toString());
      }
    });

    it('should not transfer tokens if msg.sender has already claimed tokens for a challenge', async () => {
      const registry = await Registry.deployed();
      const voting = await utils.getVoting();
      const token = Token.at(await registry.token.call());

      const applicantStartingBalance = await token.balanceOf.call(applicant);
      const aliceStartingBalance = await token.balanceOf.call(voterAlice);

      await utils.addToWhitelist(applicant, minDeposit);

      // Challenge
      const pollID = await utils.challengeAndGetPollID(applicant, challenger);

      // Alice is so committed
      await utils.commitVote(pollID, '0', 500, '420', voterAlice);
      await utils.increaseTime(paramConfig.commitStageLength + 1);

      // Alice is so revealing
      await utils.as(voterAlice, voting.revealVote, pollID, '0', '420');
      await utils.increaseTime(paramConfig.revealStageLength + 1);

      // Update status
      await utils.as(applicant, registry.updateStatus, applicant);

      // Claim reward
      await utils.as(voterAlice, registry.claimVoterReward, pollID, '420');

      try {
        await utils.as(voterAlice, registry.claimVoterReward, pollID, '420');
        assert(false, 'should not have been able to call claimVoterReward twice');
      } catch (err) {
        assert(utils.isEVMException(err), err.toString());
      }

      const applicantEndingBalance = await token.balanceOf.call(applicant);
      const appExpected = applicantStartingBalance.sub(minDeposit);

      const aliceEndingBalance = await token.balanceOf.call(voterAlice);
      const aliceExpected = aliceStartingBalance.add(minDeposit.div(bigTen(2))).sub(bigTen(500));

      assert.strictEqual(
        applicantEndingBalance.toString(10), appExpected.toString(10),
        'applicants ending balance is incorrect',
      );
      assert.strictEqual(
        aliceEndingBalance.toString(10), aliceExpected.toString(10),
        'alices ending balance is incorrect',
      );
    });

    it('should not transfer tokens for an unresolved challenge', async () => {
      const registry = await Registry.deployed();
      const voting = await utils.getVoting();
      const token = Token.at(await registry.token.call());

      const applicantStartingBalance = await token.balanceOf.call(applicant);
      const aliceStartingBalance = await token.balanceOf.call(voterAlice);

      await utils.addToWhitelist(applicant, minDeposit);

      // Challenge
      const pollID = await utils.challengeAndGetPollID(applicant, challenger);

      // Alice is so committed
      await utils.commitVote(pollID, '0', 500, '420', voterAlice);
      await utils.increaseTime(paramConfig.commitStageLength + 1);

      // Alice is so revealing
      await utils.as(voterAlice, voting.revealVote, pollID, '0', '420');
      await utils.increaseTime(paramConfig.revealStageLength + 1);

      try {
        await utils.as(voterAlice, registry.claimVoterReward, pollID, '420');
        assert(false, 'should not have been able to claimVoterReward for unresolved challenge');
      } catch (err) {
        assert(utils.isEVMException(err), err.toString());
      }

      const applicantEndingBalance = await token.balanceOf.call(applicant);
      const appExpected = applicantStartingBalance.sub(minDeposit);

      const aliceEndingBalance = await token.balanceOf.call(voterAlice);
      const aliceExpected = aliceStartingBalance.sub(bigTen(500));

      assert.strictEqual(
        applicantEndingBalance.toString(10), appExpected.toString(10),
        'applicants ending balance is incorrect',
      );
      assert.strictEqual(
        aliceEndingBalance.toString(10), aliceExpected.toString(10),
        'alices ending balance is incorrect',
      );
    });
  });
});
