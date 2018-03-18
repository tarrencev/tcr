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
  describe('Function: deposit', () => {
    const minDeposit = bigTen(paramConfig.minDeposit);
    const incAmount = minDeposit.div(bigTen(2));
    const [applicant, challenger] = accounts;

    it('should increase the deposit for a specific member in the membership', async () => {
      const registry = await Registry.deployed();

      await utils.addToWhitelist(applicant, minDeposit);
      await utils.as(applicant, registry.deposit, incAmount);

      const unstakedDeposit = await utils.getUnstakedDeposit(applicant);
      const expectedAmount = incAmount.add(minDeposit);
      assert.strictEqual(
        unstakedDeposit, expectedAmount.toString(10),
        'Unstaked deposit should be equal to the sum of the original + increase amount',
      );

      await registry.exit({ from: applicant });
    });

    it('should increase a deposit for a pending application', async () => {
      const registry = await Registry.deployed();
      await utils.as(applicant, registry.apply, minDeposit, '');

      await utils.as(applicant, registry.deposit, incAmount);

      const unstakedDeposit = await utils.getUnstakedDeposit(applicant);
      const expectedAmount = incAmount.add(minDeposit);
      assert.strictEqual(unstakedDeposit, expectedAmount.toString(10), 'Deposit should have increased for pending application');

      // Cleanup application
      await utils.increaseTime(paramConfig.applyStageLength + 1);
      await utils.as(applicant, registry.updateStatus, applicant);
      await registry.exit({ from: applicant });
    });

    it('should increase deposit for a whitelisted, challenged membership', async () => {
      const registry = await Registry.deployed();

      await utils.addToWhitelist(applicant, minDeposit);
      const originalDeposit = await utils.getUnstakedDeposit(applicant);

      // challenge, then increase deposit
      await utils.as(challenger, registry.challenge, applicant, '');
      await utils.as(applicant, registry.deposit, incAmount);

      const afterIncDeposit = await utils.getUnstakedDeposit(applicant);

      const expectedAmount = (
        bigTen(originalDeposit).add(bigTen(incAmount))
      ).sub(bigTen(minDeposit));

      assert.strictEqual(afterIncDeposit, expectedAmount.toString(10), 'Deposit should have increased for whitelisted, challenged listing');

      // Finalize challenge and remove applicant from whitelist
      await utils.increaseTime(paramConfig.commitStageLength + paramConfig.revealStageLength + 1);
      await registry.updateStatus(applicant);
    });
  });
});
