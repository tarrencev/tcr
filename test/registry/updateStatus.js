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
  describe('Function: updateStatus', () => {
    const [applicant, challenger] = accounts;
    const minDeposit = bigTen(paramConfig.minDeposit);

    it('should whitelist listing if apply stage ended without a challenge', async () => {
      const registry = await Registry.deployed();
      // note: this function calls registry.updateStatus at the end
      await utils.addToWhitelist(applicant, minDeposit);

      const result = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(result, true, 'Listing should have been whitelisted');

      await utils.removeFromWhitelist(applicant)
    });

    it('should not whitelist a listing that is still pending an application', async () => {
      const registry = await Registry.deployed();
      await utils.as(applicant, registry.apply, minDeposit, '');

      try {
        await utils.as(applicant, registry.updateStatus, applicant);
        assert(false, 'Listing should not have been whitelisted');
      } catch (err) {
        assert(utils.isEVMException(err), err.toString());
      }
    });

    it('should not whitelist a listing that is currently being challenged', async () => {
      const registry = await Registry.deployed();

      await utils.as(challenger, registry.challenge, applicant, '');

      try {
        await registry.updateStatus(applicant);
        assert(false, 'Listing should not have been whitelisted');
      } catch (err) {
        assert(utils.isEVMException(err), err.toString());
      }
    });

    it('should not whitelist a listing that failed a challenge', async () => {
      const registry = await Registry.deployed();

      const plcrComplete = paramConfig.revealStageLength + paramConfig.commitStageLength + 1;
      await utils.increaseTime(plcrComplete);

      await registry.updateStatus(applicant);
      const result = await registry.isWhitelisted(applicant);
      assert.strictEqual(result, false, 'Listing should not have been whitelisted');
    });

    it('should not be possible to add a listing to the whitelist just by calling updateStatus', async () => {
      const registry = await Registry.deployed();

      try {
        await utils.as(applicant, registry.updateStatus, applicant);
        assert(false, 'Listing should not have been whitelisted');
      } catch (err) {
        assert(utils.isEVMException(err), err.toString());
      }
    });

    it('should not be possible to add a listing to the whitelist just by calling updateStatus after it has been previously removed', async () => {
      const registry = await Registry.deployed();

      await utils.addToWhitelist(applicant, minDeposit);
      const resultOne = await registry.isWhitelisted(applicant);
      assert.strictEqual(resultOne, true, 'Listing should have been whitelisted');

      await utils.as(applicant, registry.exit);
      const resultTwo = await registry.isWhitelisted(applicant);
      assert.strictEqual(resultTwo, false, 'Listing should not be in the whitelist');

      try {
        await utils.as(applicant, registry.updateStatus, applicant);
        assert(false, 'Listing should not have been whitelisted');
      } catch (err) {
        assert(utils.isEVMException(err), err.toString());
      }
    });
  });
});
