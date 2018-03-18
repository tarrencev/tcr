/* eslint-env mocha */
/* global assert contract artifacts */
const Registry = artifacts.require('Registry.sol');
const EIP20 = artifacts.require('tokens/eip20/EIP20.sol');

const fs = require('fs');
const BN = require('bignumber.js');

const config = JSON.parse(fs.readFileSync('./conf/config.json'));
const paramConfig = config.paramDefaults;

const utils = require('../utils.js');

const bigTen = number => new BN(number.toString(10), 10);

contract('Registry', (accounts) => {
  describe('Function: withdraw', () => {
    const minDeposit = bigTen(paramConfig.minDeposit);
    const withdrawAmount = minDeposit.div(bigTen(2));
    const [applicant, challenger] = accounts;

    it('should withdraw tokens for a listing that has deposit > minDeposit', async () => {
      const registry = await Registry.deployed();
      const token = EIP20.at(await registry.token());
      const errMsg = 'applicant was not able to withdraw tokens';

      // Add the listing to the whitelist, then increase the listing's deposit by 1
      await utils.addToWhitelist(applicant, minDeposit);
      await utils.as(applicant, registry.deposit, '1');

      // Capture initial state
      const startingDeposit = await utils.getUnstakedDeposit(applicant);
      const startingBalance = await token.balanceOf.call(applicant);

      // Withdraw 1 from the deposit
      await utils.as(applicant, registry.withdraw, '1');

      // Get final state
      const finalDeposit = await utils.getUnstakedDeposit(applicant);
      const finalBalance = await token.balanceOf.call(applicant);

      // The final deposit should be the starting deposit minus 1.
      assert.strictEqual(
        finalDeposit.toString(10),
        new BN(startingDeposit, 10).minus(new BN('1', 10)).toString(10),
        errMsg,
      );

      // The final balance should be the starting balance plus 1.
      assert.strictEqual(
        finalBalance.toString(10),
        startingBalance.plus(new BN('1', 10)).toString(10),
        errMsg,
      );

      await utils.removeFromWhitelist(applicant);
    });

    it('should not withdraw tokens from a member that has a deposit === minDeposit', async () => {
      const registry = await Registry.deployed();
      const errMsg = 'applicant was able to withdraw tokens';

      await utils.addToWhitelist(applicant, minDeposit);
      const origDeposit = await utils.getUnstakedDeposit(applicant);

      try {
        await utils.as(applicant, registry.withdraw, withdrawAmount);
        assert(false, errMsg);
      } catch (err) {
        assert(utils.isEVMException(err), err.toString());
      }

      const afterWithdrawDeposit = await utils.getUnstakedDeposit(applicant);

      assert.strictEqual(afterWithdrawDeposit.toString(10), origDeposit.toString(10), errMsg);

      await utils.removeFromWhitelist(applicant);
    });

    it('should not withdraw tokens from a listing that is locked in a challenge', async () => {
      const registry = await Registry.deployed();

      // Whitelist, then challenge
      await utils.addToWhitelist(applicant, minDeposit);
      await utils.as(challenger, registry.challenge, applicant, '');

      try {
        // Attempt to withdraw; should fail
        await utils.as(applicant, registry.withdraw, withdrawAmount);
        assert.strictEqual(false, 'Applicant should not have been able to withdraw from a challenged, locked listing');
      } catch (err) {
        const errMsg = err.toString();
        assert(utils.isEVMException(err), errMsg);
      }
      // TODO: check balance
      // TODO: apply, gets challenged, and then minDeposit lowers during challenge.
      // still shouldn't be able to withdraw anything.
      // when challenge ends, should be able to withdraw origDeposit - new minDeposit
    });
  });
});
