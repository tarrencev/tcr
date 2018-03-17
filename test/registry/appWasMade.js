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
  describe('Function: appWasMade', () => {
    const [applicant] = accounts;
    const minDeposit = bigTen(paramConfig.minDeposit);
    it('should return true if applicationExpiry was previously initialized', async () => {
      const registry = await Registry.deployed();

      // Apply
      await utils.as(applicant, registry.apply, minDeposit, '');
      const result = await registry.appWasMade(applicant);
      assert.strictEqual(result, true, 'should have returned true for the applied listing');

      // Commit stage complete
      await utils.increaseTime(paramConfig.commitStageLength + 1);
      const resultTwo = await registry.appWasMade(applicant);
      assert.strictEqual(resultTwo, true, 'should have returned true because app is still not expired');

      // Reveal stage complete, update status (whitelist it)
      await utils.increaseTime(paramConfig.revealStageLength + 1);
      await utils.as(applicant, registry.updateStatus, applicant);
      const isWhitelisted = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(isWhitelisted, true, 'should have been whitelisted');
      const resultThree = await registry.appWasMade(applicant);
      assert.strictEqual(resultThree, true, 'should have returned true because its whitelisted');

      // Exit
      await utils.as(applicant, registry.exit);
      const resultFour = await registry.appWasMade(applicant);
      assert.strictEqual(resultFour, false, 'should have returned false because exit');
    });

    it('should return false if applicationExpiry was uninitialized', async () => {
      const registry = await Registry.deployed();

      const result = await registry.appWasMade(applicant);
      assert.strictEqual(result, false, 'should have returned false because listing was never applied');
    });
  });
});
