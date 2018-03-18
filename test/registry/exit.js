/* eslint-env mocha */
/* global assert contract artifacts */
const Registry = artifacts.require('Registry.sol');
const Token = artifacts.require('EIP20.sol');

const fs = require('fs');

const config = JSON.parse(fs.readFileSync('./conf/config.json'));
const paramConfig = config.paramDefaults;

const utils = require('../utils.js');

contract('Registry', (accounts) => {
  describe('Function: exit', () => {
    const [applicant, challenger, voter] = accounts;

    it('should allow a listing to exit when no challenge exists', async () => {
      const registry = await Registry.deployed();
      const token = Token.at(await registry.token.call());

      const initialApplicantTokenHoldings = await token.balanceOf.call(applicant);

      await utils.addToWhitelist(applicant, paramConfig.minDeposit);

      const isWhitelisted = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(isWhitelisted, true, 'the member was not added to the registry');

      const receipt = await registry.exit({ from: applicant });

      const isWhitelistedAfterExit = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(isWhitelistedAfterExit, false, 'the member was not removed on exit');

      const finalApplicantTokenHoldings = await token.balanceOf.call(applicant);
      assert.strictEqual(
        initialApplicantTokenHoldings.toString(10),
        finalApplicantTokenHoldings.toString(10),
        'the applicant\'s tokens were not returned to them after exiting the registry',
      );

      const removedMember = utils.getReceiptValue(receipt, 'member');
      assert.strictEqual(removedMember, applicant, 'The _MemberRemoved event did not fire properly');
    });

    it('should not allow a listing to exit when a challenge does exist', async () => {
      const registry = await Registry.deployed();
      const token = Token.at(await registry.token.call());

      const initialApplicantTokenHoldings = await token.balanceOf.call(applicant);

      await utils.addToWhitelist(applicant, paramConfig.minDeposit);

      const isWhitelisted = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(isWhitelisted, true, 'the member was not added to the registry');

      await registry.challenge(applicant, '', { from: challenger });
      try {
        await registry.exit({ from: applicant });
        assert(false, 'exit succeeded when it should have failed');
      } catch (err) {
        const errMsg = err.toString();
        assert(utils.isEVMException(err), errMsg);
      }

      const isWhitelistedAfterExit = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(
        isWhitelistedAfterExit,
        true,
        'the member was able to exit while a challenge was active',
      );

      const finalApplicantTokenHoldings = await token.balanceOf.call(applicant);
      assert(
        initialApplicantTokenHoldings.gt(finalApplicantTokenHoldings),
        'the applicant\'s tokens were returned in spite of failing to exit',
      );

      // Clean up state, remove consensys.net (it fails its challenge due to draw)
      await utils.increaseTime(paramConfig.commitStageLength + paramConfig.revealStageLength + 1);
      await registry.updateStatus(applicant);
    });

    it('should not allow a listing to be exited by someone who doesn\'t own it', async () => {
      const registry = await Registry.deployed();

      await utils.addToWhitelist(applicant, paramConfig.minDeposit);

      try {
        await registry.exit({ from: voter });
        assert(false, 'exit succeeded when it should have failed');
      } catch (err) {
        const errMsg = err.toString();
        assert(utils.isEVMException(err), errMsg);
      }
      const isWhitelistedAfterExit = await registry.isWhitelisted.call(applicant);
      assert.strictEqual(
        isWhitelistedAfterExit,
        true,
        'the listing was exited by someone other than its owner',
      );
    });
  });
});
