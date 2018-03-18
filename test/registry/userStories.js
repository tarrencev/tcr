/* eslint-env mocha */
/* global assert contract artifacts */
const Registry = artifacts.require('Registry.sol');

const fs = require('fs');
const BN = require('bignumber.js');

const config = JSON.parse(fs.readFileSync('./conf/config.json'));
const paramConfig = config.paramDefaults;

const utils = require('../utils.js');

const bigTen = number => new BN(number.toString(10), 10);

contract('Registry', (accounts) => {
  describe('User stories', () => {
    const [applicant, challenger, voter] = accounts;
    const minDeposit = bigTen(paramConfig.minDeposit);

    it('should apply, fail challenge, and reject applicant', async () => {
      const registry = await Registry.deployed();
      await registry.apply(paramConfig.minDeposit, '', { from: applicant });
      await registry.challenge(applicant, '', { from: challenger });

      await utils.increaseTime(paramConfig.revealStageLength + paramConfig.commitStageLength + 1);
      await registry.updateStatus(applicant);

      // should not have been added to whitelist
      const result = await registry.isWhitelisted(applicant);
      assert.strictEqual(result, false, 'applicant should not be whitelisted');
    });

    it('should apply, pass challenge, and whitelist applicant', async () => {
      const registry = await Registry.deployed();
      const voting = await utils.getVoting();

      await utils.as(applicant, registry.apply, minDeposit, '');

      // Challenge and get back the pollID
      const pollID = await utils.challengeAndGetPollID(applicant, challenger);

      // Make sure it's cool to commit
      const cpa = await voting.commitPeriodActive.call(pollID);
      assert.strictEqual(cpa, true, 'Commit period should be active');

      // Virgin commit
      const tokensArg = 10;
      const salt = 420;
      const voteOption = 1;
      await utils.commitVote(pollID, voteOption, tokensArg, salt, voter);

      const numTokens = await voting.getNumTokens.call(voter, pollID);
      assert.strictEqual(numTokens.toString(10), tokensArg.toString(10), 'Should have committed the correct number of tokens');

      // Reveal
      await utils.increaseTime(paramConfig.commitStageLength + 1);
      // Make sure commit period is inactive
      const commitPeriodActive = await voting.commitPeriodActive.call(pollID);
      assert.strictEqual(commitPeriodActive, false, 'Commit period should be inactive');
      // Make sure reveal period is active
      let rpa = await voting.revealPeriodActive.call(pollID);
      assert.strictEqual(rpa, true, 'Reveal period should be active');

      await voting.revealVote(pollID, voteOption, salt, { from: voter });

      // End reveal period
      await utils.increaseTime(paramConfig.revealStageLength + 1);
      rpa = await voting.revealPeriodActive.call(pollID);
      assert.strictEqual(rpa, false, 'Reveal period should not be active');

      // updateStatus
      const pollResult = await voting.isPassed.call(pollID);
      assert.strictEqual(pollResult, true, 'Poll should have passed');

      // Add to whitelist
      await registry.updateStatus(applicant);
      const result = await registry.isWhitelisted(applicant);
      assert.strictEqual(result, true, 'Listing should be whitelisted');
    });
  });
});
