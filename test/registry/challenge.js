/* eslint-env mocha */
/* global assert contract artifacts */
const Registry = artifacts.require('Registry.sol');
const Parameterizer = artifacts.require('Parameterizer.sol');
const Token = artifacts.require('EIP20.sol');

const fs = require('fs');
const BN = require('bignumber.js');

const config = JSON.parse(fs.readFileSync('./conf/config.json'));
const paramConfig = config.paramDefaults;

const utils = require('../utils.js');

const bigTen = number => new BN(number.toString(10), 10);

contract('Registry', (accounts) => {
  describe('Function: challenge', () => {
    const [applicant, challenger, voter, proposer] = accounts;

    it('should successfully challenge an application', async () => {
      const registry = await Registry.deployed();
      const token = Token.at(await registry.token.call());

      const challengerStartingBalance = await token.balanceOf.call(challenger);

      await utils.as(applicant, registry.apply, paramConfig.minDeposit, '');
      await utils.challengeAndGetPollID(applicant, challenger);
      await utils.increaseTime(paramConfig.commitStageLength + paramConfig.revealStageLength + 1);
      await registry.updateStatus(applicant);

      const isWhitelisted = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(isWhitelisted, false, 'An application which should have failed succeeded');

      const challengerFinalBalance = await token.balanceOf.call(challenger);
      // Note edge case: no voters, so challenger gets entire stake
      const expectedFinalBalance =
        challengerStartingBalance.add(new BN(paramConfig.minDeposit, 10));
      assert.strictEqual(
        challengerFinalBalance.toString(10), expectedFinalBalance.toString(10),
        'Reward not properly disbursed to challenger',
      );
    });

    it('should successfully challenge a member', async () => {
      const registry = await Registry.deployed();
      const token = Token.at(await registry.token.call());

      const challengerStartingBalance = await token.balanceOf.call(challenger);

      await utils.addToWhitelist(applicant, paramConfig.minDeposit);

      await utils.challengeAndGetPollID(applicant, challenger);
      await utils.increaseTime(paramConfig.commitStageLength + paramConfig.revealStageLength + 1);
      await registry.updateStatus(applicant);

      const isWhitelisted = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(isWhitelisted, false, 'An application which should have failed succeeded');

      const challengerFinalBalance = await token.balanceOf.call(challenger);
      // Note edge case: no voters, so challenger gets entire stake
      const expectedFinalBalance =
        challengerStartingBalance.add(new BN(paramConfig.minDeposit, 10));
      assert.strictEqual(
        challengerFinalBalance.toString(10), expectedFinalBalance.toString(10),
        'Reward not properly disbursed to challenger',
      );
    });

    it('should unsuccessfully challenge an application', async () => {
      const registry = await Registry.deployed();
      const voting = await utils.getVoting();
      const minDeposit = new BN(paramConfig.minDeposit, 10);

      await utils.as(applicant, registry.apply, minDeposit, '');
      const pollID = await utils.challengeAndGetPollID(applicant, challenger);
      await utils.commitVote(pollID, 1, 10, 420, voter);
      await utils.increaseTime(paramConfig.commitStageLength + 1);
      await utils.as(voter, voting.revealVote, pollID, 1, 420);
      await utils.increaseTime(paramConfig.revealStageLength + 1);
      await registry.updateStatus(applicant);

      const isWhitelisted = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(
        isWhitelisted, true,
        'An application which should have succeeded failed',
      );

      const unstakedDeposit = await utils.getUnstakedDeposit(applicant);
      const expectedUnstakedDeposit =
        minDeposit.add(minDeposit.mul(bigTen(paramConfig.dispensationPct).div(bigTen(100))));

      assert.strictEqual(
        unstakedDeposit.toString(10), expectedUnstakedDeposit.toString(10),
        'The challenge winner was not properly disbursed their tokens',
      );

      await registry.exit({ from: applicant });
    });

    it('should unsuccessfully challenge a membership', async () => {
      const registry = await Registry.deployed();
      const voting = await utils.getVoting();
      const minDeposit = new BN(paramConfig.minDeposit, 10);

      await utils.addToWhitelist(applicant, minDeposit);

      const pollID = await utils.challengeAndGetPollID(applicant, challenger);
      await utils.commitVote(pollID, 1, 10, 420, voter);
      await utils.increaseTime(paramConfig.commitStageLength + 1);
      await utils.as(voter, voting.revealVote, pollID, 1, 420);
      await utils.increaseTime(paramConfig.revealStageLength + 1);
      await registry.updateStatus(applicant);

      const isWhitelisted = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(isWhitelisted, true, 'An application which should have succeeded failed');

      const unstakedDeposit = await utils.getUnstakedDeposit(applicant);
      const expectedUnstakedDeposit = minDeposit.add(minDeposit.mul(new BN(paramConfig.dispensationPct, 10).div(new BN('100', 10))));
      assert.strictEqual(
        unstakedDeposit.toString(10), expectedUnstakedDeposit.toString(10),
        'The challenge winner was not properly disbursed their tokens',
      );

      await registry.exit({ from: applicant });
    });

    it('should touch-and-remove a member with a depost below the current minimum', async () => {
      const registry = await Registry.deployed();
      const parameterizer = await Parameterizer.deployed();
      const token = Token.at(await registry.token.call());
      const minDeposit = new BN(paramConfig.minDeposit, 10);
      const newMinDeposit = minDeposit.add(new BN('1', 10));

      const applicantStartingBal = await token.balanceOf.call(applicant);

      await utils.addToWhitelist(applicant, minDeposit);

      const receipt = await utils.as(
        proposer, parameterizer.proposeReparameterization,
        'minDeposit', newMinDeposit,
      );
      const propID = utils.getReceiptValue(receipt, 'propID');

      await utils.increaseTime(paramConfig.pApplyStageLength + 1);

      await parameterizer.processProposal(propID);

      const challengerStartingBal = await token.balanceOf.call(challenger);
      utils.as(challenger, registry.challenge, applicant, '');
      const challengerFinalBal = await token.balanceOf.call(challenger);

      assert(
        challengerStartingBal.eq(challengerFinalBal),
        'Tokens were not returned to challenger',
      );

      const applicantFinalBal = await token.balanceOf.call(applicant);

      assert(
        applicantStartingBal.eq(applicantFinalBal),
        'Tokens were not returned to applicant',
      );

      assert(!await registry.isWhitelisted.call(applicant), 'Member was not removed');
    });
  });
});
