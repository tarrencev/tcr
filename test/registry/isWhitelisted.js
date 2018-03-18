/* eslint-env mocha */
/* global assert contract artifacts */
const Registry = artifacts.require('Registry.sol');

const fs = require('fs');

const config = JSON.parse(fs.readFileSync('./conf/config.json'));
const paramConfig = config.paramDefaults;

const utils = require('../utils.js');

contract('Registry', (accounts) => {
  describe('Function: isWhitelisted', () => {
    const [applicant] = accounts;

    it('should verify a membership is not in the whitelist', async () => {
      const registry = await Registry.deployed();
      const result = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(result, false, 'Member should not be whitelisted');
    });

    it('should verify a membership is in the whitelist', async () => {
      const registry = await Registry.deployed();
      await utils.addToWhitelist(applicant, paramConfig.minDeposit);
      const result = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(result, true, 'Member should have been whitelisted');
    });
  });
});
