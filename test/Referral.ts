/* eslint-disable @typescript-eslint/naming-convention */
import {expect} from "chai";
import {ethers} from "hardhat";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";

describe("referral", () => {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  const deploy = async () => {
    const [owner, user, inviter1, inviter2, inviter3] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token");
    const usdt = await Token.deploy("Tether USD", "USDT", 6);

    const WETH = await ethers.getContractFactory("WETH");
    const weth = await WETH.deploy();

    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(weth.address);

    const Referral = await ethers.getContractFactory("Referral");
    const referral = await Referral.deploy(vault.address, usdt.address);

    return {
      referral,
      vault,

      usdt,

      owner,
      user,

      inviter1,
      inviter2,
      inviter3,
    };
  };

  describe("constructor()", () => {
    it("should set the right access", async () => {
      const {referral, owner, user} = await loadFixture(deploy);
      const role = await referral.DEFAULT_ADMIN_ROLE();

      expect(await referral.hasRole(role, owner.address)).to.equal(true);
      expect(await referral.hasRole(role, user.address)).to.equal(false);
    });
  });

  describe("updateRevShareFee()", () => {
    it("should update rev share fee", async () => {
      const {referral} = await loadFixture(deploy);
      const revShareFeeBefore = await referral.revShareFee();

      await referral.updateRevShareFee(0.05 * 1e8);

      const revShareFeeAfter = await referral.revShareFee();

      expect(revShareFeeBefore).to.be.equal(0);
      expect(revShareFeeAfter).to.be.equal(0.05 * 1e8);
    });

    it("should not update rev share fee if has no access", async () => {
      const {referral, user} = await loadFixture(deploy);
      const revShareFeeBefore = await referral.revShareFee();

      const tx = referral.connect(user).updateRevShareFee(0.05 * 1e8);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const revShareFeeAfter = await referral.revShareFee();

      expect(revShareFeeBefore).to.be.equal(0);
      expect(revShareFeeAfter).to.be.equal(0);
    });
  });

  describe("updateInviter()", () => {
    it("should update inviter", async () => {
      const {referral, user} = await loadFixture(deploy);

      const inviterBefore = await referral.inviters(user.address);

      await referral.updateInviter(user.address, {
        level: 1,
        revShareFee: 0.2 * 1e8,
      });

      const inviterAfter = await referral.inviters(user.address);

      expect(inviterBefore.level).to.be.equal(0);
      expect(inviterBefore.revShareFee).to.be.equal(0);

      expect(inviterAfter.level).to.be.equal(1);
      expect(inviterAfter.revShareFee).to.be.equal(0.2 * 1e8);
    });

    it("should not update inviter if has no access", async () => {
      const {referral, user} = await loadFixture(deploy);

      const inviterBefore = await referral.inviters(user.address);

      const tx = referral.connect(user).updateInviter(user.address, {
        level: 1,
        revShareFee: 0.2 * 1e8,
      });

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const inviterAfter = await referral.inviters(user.address);

      expect(inviterBefore.level).to.be.equal(0);
      expect(inviterBefore.revShareFee).to.be.equal(0);

      expect(inviterAfter.level).to.be.equal(0);
      expect(inviterAfter.revShareFee).to.be.equal(0);
    });
  });

  describe("earn()", () => {
    it("should earn", async () => {
      const {referral, user, inviter1} = await loadFixture(deploy);

      await referral.updateRevShareFee(0.1 * 1e8);

      const tx = await referral.earn(user.address, 10 * 1e6, inviter1.address);
      const receipt = await tx.wait();

      const _user = await referral.users(user.address);
      const _inviter = await referral.inviters(inviter1.address);

      expect(_user).to.be.equal(inviter1.address);

      expect(_inviter.level).to.be.equal(0);
      expect(_inviter.revShareFee).to.be.equal(0);
      expect(_inviter.unclaimedBalance).to.be.equal(1e6);
      expect(_inviter.claimedBalance).to.be.equal(0);

      expect(receipt.events.length).to.be.equal(1);

      expect(receipt.events[0].event).to.be.equal("Earning");
      expect(receipt.events[0].args).to.be.deep.equal([inviter1.address, user.address, 1e6, 0]);
    });

    it("should earn if disabled new & assigned inviter", async () => {
      const {referral, user, inviter1} = await loadFixture(deploy);

      await referral.updateRevShareFee(0.1 * 1e8);

      const tx1 = await referral.earn(user.address, 10 * 1e6, inviter1.address);
      const receipt1 = await tx1.wait();

      const _user1 = await referral.users(user.address);
      const _inviter1 = await referral.inviters(inviter1.address);

      await referral.disableNew();

      const enabledNew = await referral.enabledNew();

      const tx2 = await referral.earn(user.address, 20 * 1e6, inviter1.address);
      const receipt2 = await tx2.wait();

      const _user2 = await referral.users(user.address);
      const _inviter2 = await referral.inviters(inviter1.address);

      expect(enabledNew).to.be.equal(false);

      expect(_user1).to.be.equal(inviter1.address);
      expect(_user2).to.be.equal(inviter1.address);

      expect(_inviter1.level).to.be.equal(0);
      expect(_inviter1.revShareFee).to.be.equal(0);
      expect(_inviter1.unclaimedBalance).to.be.equal(1e6);
      expect(_inviter1.claimedBalance).to.be.equal(0);

      expect(_inviter2.level).to.be.equal(0);
      expect(_inviter2.revShareFee).to.be.equal(0);
      expect(_inviter2.unclaimedBalance).to.be.equal((10 + 20) * 1e6 * 0.1);
      expect(_inviter2.claimedBalance).to.be.equal(0);

      expect(receipt1.events.length).to.be.equal(1);

      expect(receipt1.events[0].event).to.be.equal("Earning");
      expect(receipt1.events[0].args).to.be.deep.equal([inviter1.address, user.address, 1e6, 0]);

      expect(receipt2.events.length).to.be.equal(1);

      expect(receipt2.events[0].event).to.be.equal("Earning");
      expect(receipt2.events[0].args).to.be.deep.equal([inviter1.address, user.address, 20 * 1e6 * 0.1, 0]);
    });

    it("should earn with recursion if level = 1", async () => {
      const {referral, user, inviter1, inviter2} = await loadFixture(deploy);

      await referral.updateRevShareFee(0.1 * 1e8);

      await referral.updateInviter(inviter2.address, {
        level: 1,
        revShareFee: 0.2 * 1e8,
      });

      const inviter1Before = await referral.inviters(inviter1.address);
      const inviter2Before = await referral.inviters(inviter2.address);

      const inviter1RelatesBefore = await referral.users(inviter1.address);
      const inviter2RelatesBefore = await referral.users(inviter2.address);
      const userRelatesBefore = await referral.users(user.address);

      // inviter2 should receive a rev share from inviter1              (20% from inviter1's profit)
      const tx1 = await referral.earn(inviter1.address, 10 * 1e6, inviter2.address);
      const receipt1 = await tx1.wait();

      // inviter1 should receive a rev share from user, and             (10% from user's profit)
      // inviter2 should receive a rev share from inviter1's rev share  (2%  from user's profit)
      const tx2 = await referral.earn(user.address, 20 * 1e6, inviter1.address);
      const receipt2 = await tx2.wait();

      const inviter1After = await referral.inviters(inviter1.address);
      const inviter2After = await referral.inviters(inviter2.address);

      const inviter1RelatesAfter = await referral.users(inviter1.address);
      const inviter2RelatesAfter = await referral.users(inviter2.address);
      const userRelatesAfter = await referral.users(user.address);

      expect(receipt1.events.length).to.be.equal(1);
      expect(receipt1.events[0].event).to.be.equal("Earning");
      expect(receipt1.events[0].args).to.be.deep.equal([inviter2.address, inviter1.address, 10 * 1e6 * 0.2, 0]);

      expect(receipt2.events.length).to.be.equal(2);
      expect(receipt2.events[0].event).to.be.equal("Earning");
      expect(receipt2.events[0].args).to.be.deep.equal([inviter1.address, user.address, 20 * 1e6 * 0.1, 0]);
      expect(receipt2.events[1].event).to.be.equal("Earning");
      expect(receipt2.events[1].args).to.be.deep.equal([inviter2.address, inviter1.address, 20 * 1e6 * 0.02, 1]);

      expect(inviter1RelatesBefore).to.be.equal("0x0000000000000000000000000000000000000000");
      expect(inviter2RelatesBefore).to.be.equal("0x0000000000000000000000000000000000000000");
      expect(userRelatesBefore).to.be.equal("0x0000000000000000000000000000000000000000");

      expect(inviter1RelatesAfter).to.be.equal(inviter2.address);
      expect(inviter2RelatesAfter).to.be.equal(referral.address);
      expect(userRelatesAfter).to.be.equal(inviter1.address);

      expect(inviter1Before.level).to.be.equal(0);
      expect(inviter1Before.revShareFee).to.be.equal(0);
      expect(inviter1Before.unclaimedBalance).to.be.equal(0);
      expect(inviter1Before.claimedBalance).to.be.equal(0);

      expect(inviter1After.level).to.be.equal(0);
      expect(inviter1After.revShareFee).to.be.equal(0);
      expect(inviter1After.unclaimedBalance).to.be.equal(2 * 1e6);
      expect(inviter1After.claimedBalance).to.be.equal(0);

      expect(inviter2Before.level).to.be.equal(1);
      expect(inviter2Before.revShareFee).to.be.equal(0.2 * 1e8);
      expect(inviter2Before.unclaimedBalance).to.be.equal(0);
      expect(inviter2Before.claimedBalance).to.be.equal(0);

      expect(inviter2After.level).to.be.equal(1);
      expect(inviter2After.revShareFee).to.be.equal(0.2 * 1e8);
      expect(inviter2After.unclaimedBalance).to.be.equal((2 + 0.4) * 1e6);
      expect(inviter2After.claimedBalance).to.be.equal(0);
    });

    it("should earn without recursion if level = 0", async () => {
      const {referral, user, inviter1, inviter2} = await loadFixture(deploy);

      await referral.updateRevShareFee(0.1 * 1e8);

      const inviter1Before = await referral.inviters(inviter1.address);
      const inviter2Before = await referral.inviters(inviter2.address);

      const inviter1RelatesBefore = await referral.users(inviter1.address);
      const inviter2RelatesBefore = await referral.users(inviter2.address);
      const userRelatesBefore = await referral.users(user.address);

      // inviter2 should receive a rev share from inviter1              (10% from inviter1's profit)
      const tx1 = await referral.earn(inviter1.address, 10 * 1e6, inviter2.address);
      const receipt1 = await tx1.wait();

      // inviter1 should receive a rev share from user, and             (10% from user's profit)
      const tx2 = await referral.earn(user.address, 20 * 1e6, inviter1.address);
      const receipt2 = await tx2.wait();

      const inviter1After = await referral.inviters(inviter1.address);
      const inviter2After = await referral.inviters(inviter2.address);

      const inviter1RelatesAfter = await referral.users(inviter1.address);
      const inviter2RelatesAfter = await referral.users(inviter2.address);
      const userRelatesAfter = await referral.users(user.address);

      expect(receipt1.events.length).to.be.equal(1);
      expect(receipt1.events[0].event).to.be.equal("Earning");
      expect(receipt1.events[0].args).to.be.deep.equal([inviter2.address, inviter1.address, 10 * 1e6 * 0.1, 0]);

      expect(receipt2.events.length).to.be.equal(1);
      expect(receipt2.events[0].event).to.be.equal("Earning");
      expect(receipt2.events[0].args).to.be.deep.equal([inviter1.address, user.address, 20 * 1e6 * 0.1, 0]);

      expect(inviter1RelatesBefore).to.be.equal("0x0000000000000000000000000000000000000000");
      expect(inviter2RelatesBefore).to.be.equal("0x0000000000000000000000000000000000000000");
      expect(userRelatesBefore).to.be.equal("0x0000000000000000000000000000000000000000");

      expect(inviter1RelatesAfter).to.be.equal(inviter2.address);
      expect(inviter2RelatesAfter).to.be.equal(referral.address);
      expect(userRelatesAfter).to.be.equal(inviter1.address);

      expect(inviter1Before.level).to.be.equal(0);
      expect(inviter1Before.revShareFee).to.be.equal(0);
      expect(inviter1Before.unclaimedBalance).to.be.equal(0);
      expect(inviter1Before.claimedBalance).to.be.equal(0);

      expect(inviter1After.level).to.be.equal(0);
      expect(inviter1After.revShareFee).to.be.equal(0);
      expect(inviter1After.unclaimedBalance).to.be.equal(2 * 1e6);
      expect(inviter1After.claimedBalance).to.be.equal(0);

      expect(inviter2Before.level).to.be.equal(0);
      expect(inviter2Before.revShareFee).to.be.equal(0);
      expect(inviter2Before.unclaimedBalance).to.be.equal(0);
      expect(inviter2Before.claimedBalance).to.be.equal(0);

      expect(inviter2After.level).to.be.equal(0);
      expect(inviter2After.revShareFee).to.be.equal(0);
      expect(inviter2After.unclaimedBalance).to.be.equal(1e6);
      expect(inviter2After.claimedBalance).to.be.equal(0);
    });

    it("should not earn if has no access", async () => {
      const {referral, user, inviter1} = await loadFixture(deploy);

      const inviterBefore = await referral.inviters(inviter1.address);

      await referral.updateRevShareFee(0.1 * 1e8);

      const tx = referral.connect(user).earn(user.address, 10 * 1e6, inviter1.address);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const inviterAfter = await referral.inviters(inviter1.address);

      expect(inviterBefore.level).to.be.equal(0);
      expect(inviterBefore.revShareFee).to.be.equal(0);

      expect(inviterAfter.level).to.be.equal(0);
      expect(inviterAfter.revShareFee).to.be.equal(0);
    });

    it("should not earn if disabled", async () => {
      const {referral, user, inviter1} = await loadFixture(deploy);

      await referral.updateRevShareFee(0.1 * 1e8);
      await referral.disable();

      const tx = await referral.earn(user.address, 10 * 1e6, inviter1.address);
      const receipt = await tx.wait();

      const _user = await referral.users(user.address);
      const _inviter = await referral.inviters(inviter1.address);

      expect(_user).to.be.equal("0x0000000000000000000000000000000000000000");

      expect(_inviter.level).to.be.equal(0);
      expect(_inviter.revShareFee).to.be.equal(0);
      expect(_inviter.unclaimedBalance).to.be.equal(0);
      expect(_inviter.claimedBalance).to.be.equal(0);

      expect(receipt.events.length).to.be.equal(0);
    });

    it("should not earn if disabled new & no assigned inviter", async () => {
      const {referral, user, inviter1} = await loadFixture(deploy);

      await referral.updateRevShareFee(0.1 * 1e8);
      await referral.disableNew();

      const enabledNew = await referral.enabledNew();

      const tx = await referral.earn(user.address, 10 * 1e6, inviter1.address);
      const receipt = await tx.wait();

      const _user = await referral.users(user.address);
      const _inviter = await referral.inviters(inviter1.address);

      expect(enabledNew).to.be.equal(false);

      expect(_user).to.be.equal("0x0000000000000000000000000000000000000000");

      expect(_inviter.level).to.be.equal(0);
      expect(_inviter.revShareFee).to.be.equal(0);
      expect(_inviter.unclaimedBalance).to.be.equal(0);
      expect(_inviter.claimedBalance).to.be.equal(0);

      expect(receipt.events.length).to.be.equal(0);
    });

    it("should not earn if rev share fee = 0", async () => {
      const {referral, user, inviter1} = await loadFixture(deploy);

      await referral.updateRevShareFee(0);

      const tx = await referral.earn(user.address, 10 * 1e6, inviter1.address);
      const receipt = await tx.wait();

      const _user = await referral.users(user.address);
      const _inviter = await referral.inviters(inviter1.address);

      expect(_user).to.be.equal("0x0000000000000000000000000000000000000000");

      expect(_inviter.level).to.be.equal(0);
      expect(_inviter.revShareFee).to.be.equal(0);
      expect(_inviter.unclaimedBalance).to.be.equal(0);
      expect(_inviter.claimedBalance).to.be.equal(0);

      expect(receipt.events.length).to.be.equal(0);
    });

    // todo: inviter of user should be contract
    it("should not earn if inviter = user", async () => {
      const {referral, user} = await loadFixture(deploy);

      await referral.updateRevShareFee(0.1 * 1e8);
      await referral.disable();

      const tx = await referral.earn(user.address, 10 * 1e6, user.address);
      const receipt = await tx.wait();

      const _user = await referral.users(user.address);
      const _inviter = await referral.inviters(user.address);

      expect(_user).to.be.equal("0x0000000000000000000000000000000000000000");

      expect(_inviter.level).to.be.equal(0);
      expect(_inviter.revShareFee).to.be.equal(0);
      expect(_inviter.unclaimedBalance).to.be.equal(0);
      expect(_inviter.claimedBalance).to.be.equal(0);

      expect(receipt.events.length).to.be.equal(0);
    });

    it("should not earn if inviter = 0", async () => {
      const {referral, user, inviter1} = await loadFixture(deploy);

      await referral.updateRevShareFee(0.1 * 1e8);

      const tx1 = await referral.earn(user.address, 10 * 1e6, "0x0000000000000000000000000000000000000000");
      const receipt1 = await tx1.wait();

      const _user1 = await referral.users(user.address);
      const _inviter1 = await referral.inviters(inviter1.address);
      const _referral1 = await referral.inviters(referral.address);

      const tx2 = await referral.earn(user.address, 20 * 1e6, inviter1.address);
      const receipt2 = await tx2.wait();

      const _user2 = await referral.users(user.address);
      const _inviter2 = await referral.inviters(inviter1.address);
      const _referral2 = await referral.inviters(referral.address);

      expect(_user1).to.be.equal(referral.address);

      expect(_inviter1.level).to.be.equal(0);
      expect(_inviter1.revShareFee).to.be.equal(0);
      expect(_inviter1.unclaimedBalance).to.be.equal(0);
      expect(_inviter1.claimedBalance).to.be.equal(0);

      expect(_referral1.level).to.be.equal(0);
      expect(_referral1.revShareFee).to.be.equal(0);
      expect(_referral1.unclaimedBalance).to.be.equal(0);
      expect(_referral1.claimedBalance).to.be.equal(0);

      expect(receipt1.events.length).to.be.equal(0);

      expect(_user2).to.be.equal(referral.address);

      expect(_inviter2.level).to.be.equal(0);
      expect(_inviter2.revShareFee).to.be.equal(0);
      expect(_inviter2.unclaimedBalance).to.be.equal(0);
      expect(_inviter2.claimedBalance).to.be.equal(0);

      expect(_referral2.level).to.be.equal(0);
      expect(_referral2.revShareFee).to.be.equal(0);
      expect(_referral2.unclaimedBalance).to.be.equal(0);
      expect(_referral2.claimedBalance).to.be.equal(0);

      expect(receipt2.events.length).to.be.equal(0);
    });
  });

  describe("claim()", () => {
    it("should claim", async () => {
      const {referral, vault, usdt, user, inviter1} = await loadFixture(deploy);

      // grant & top up vault
      await vault.grantRole(await vault.DEFAULT_ADMIN_ROLE(), referral.address);
      await usdt.transfer(vault.address, 100 * 1e6);

      await referral.updateRevShareFee(0.1 * 1e8);
      await referral.earn(user.address, 10 * 1e6, inviter1.address);

      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const inviterBalanceBefore = await usdt.balanceOf(inviter1.address);

      const inviterBefore = await referral.inviters(inviter1.address);

      const tx = await referral.connect(inviter1).claim();
      const receipt = await tx.wait();

      const vaultBalanceAfter = await usdt.balanceOf(vault.address);
      const inviterBalanceAfter = await usdt.balanceOf(inviter1.address);

      const inviterAfter = await referral.inviters(inviter1.address);

      expect(vaultBalanceBefore).to.be.equal(100 * 1e6);
      expect(inviterBalanceBefore).to.be.equal(0);

      expect(vaultBalanceAfter).to.be.equal(99 * 1e6);
      expect(inviterBalanceAfter).to.be.equal(1e6);

      expect(inviterBefore.level).to.be.equal(0);
      expect(inviterBefore.revShareFee).to.be.equal(0);
      expect(inviterBefore.unclaimedBalance).to.be.equal(1e6);
      expect(inviterBefore.claimedBalance).to.be.equal(0);

      expect(inviterAfter.level).to.be.equal(0);
      expect(inviterAfter.revShareFee).to.be.equal(0);
      expect(inviterAfter.unclaimedBalance).to.be.equal(0);
      expect(inviterAfter.claimedBalance).to.be.equal(1e6);

      expect(receipt.events.length).to.be.equal(2);

      expect(receipt.events[0].address).to.be.equal(usdt.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        vault.address,
        inviter1.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(1e6);

      expect(receipt.events[1].event).to.be.equal("Claim");
      expect(receipt.events[1].args).to.be.deep.equal([inviter1.address, 1e6]);
    });

    it("should not claim if has unclaimed balance = 0", async () => {
      const {referral, vault, usdt, inviter1} = await loadFixture(deploy);

      // grant & top up vault
      await vault.grantRole(await vault.DEFAULT_ADMIN_ROLE(), referral.address);
      await usdt.transfer(vault.address, 100 * 1e6);

      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const inviterBalanceBefore = await usdt.balanceOf(inviter1.address);

      const inviterBefore = await referral.inviters(inviter1.address);

      const tx = referral.connect(inviter1).claim();

      await expect(tx).to.be.revertedWith("Nothing to claim");

      const vaultBalanceAfter = await usdt.balanceOf(vault.address);
      const inviterBalanceAfter = await usdt.balanceOf(inviter1.address);

      const inviterAfter = await referral.inviters(inviter1.address);

      expect(vaultBalanceBefore).to.be.equal(100 * 1e6);
      expect(inviterBalanceBefore).to.be.equal(0);

      expect(vaultBalanceAfter).to.be.equal(100 * 1e6);
      expect(inviterBalanceAfter).to.be.equal(0);

      expect(inviterBefore.level).to.be.equal(0);
      expect(inviterBefore.revShareFee).to.be.equal(0);
      expect(inviterBefore.unclaimedBalance).to.be.equal(0);
      expect(inviterBefore.claimedBalance).to.be.equal(0);

      expect(inviterAfter.level).to.be.equal(0);
      expect(inviterAfter.revShareFee).to.be.equal(0);
      expect(inviterAfter.unclaimedBalance).to.be.equal(0);
      expect(inviterAfter.claimedBalance).to.be.equal(0);
    });

    it("should not claim if vault has no funds", async () => {
      const {referral, vault, usdt, user, inviter1} = await loadFixture(deploy);

      // grant & top up vault
      await vault.grantRole(await vault.DEFAULT_ADMIN_ROLE(), referral.address);
      await usdt.transfer(vault.address, 100 * 1e6);

      await referral.updateRevShareFee(0.1 * 1e8);
      await referral.earn(user.address, 2000 * 1e6, inviter1.address);

      const vaultBalanceBefore = await usdt.balanceOf(vault.address);
      const inviterBalanceBefore = await usdt.balanceOf(inviter1.address);

      const inviterBefore = await referral.inviters(inviter1.address);

      const tx = referral.connect(inviter1).claim();

      await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      const vaultBalanceAfter = await usdt.balanceOf(vault.address);
      const inviterBalanceAfter = await usdt.balanceOf(inviter1.address);

      const inviterAfter = await referral.inviters(inviter1.address);

      expect(vaultBalanceBefore).to.be.equal(100 * 1e6);
      expect(inviterBalanceBefore).to.be.equal(0);

      expect(vaultBalanceAfter).to.be.equal(100 * 1e6);
      expect(inviterBalanceAfter).to.be.equal(0);

      expect(inviterBefore.level).to.be.equal(0);
      expect(inviterBefore.revShareFee).to.be.equal(0);
      expect(inviterBefore.unclaimedBalance).to.be.equal(200 * 1e6);
      expect(inviterBefore.claimedBalance).to.be.equal(0);

      expect(inviterAfter.level).to.be.equal(0);
      expect(inviterAfter.revShareFee).to.be.equal(0);
      expect(inviterAfter.unclaimedBalance).to.be.equal(200 * 1e6);
      expect(inviterAfter.claimedBalance).to.be.equal(0);
    });
  });

  describe("disable()", () => {
    it("should disable", async () => {
      const {referral} = await loadFixture(deploy);
      const enabledBefore = await referral.enabled();

      await referral.disable();

      const enabledAfter = await referral.enabled();

      expect(enabledBefore).to.be.equal(true);
      expect(enabledAfter).to.be.equal(false);
    });

    it("should not disable if has no access", async () => {
      const {referral, user} = await loadFixture(deploy);
      const enabledBefore = await referral.enabled();

      const tx = referral.connect(user).disable();

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const enabledAfter = await referral.enabled();

      expect(enabledBefore).to.be.equal(true);
      expect(enabledAfter).to.be.equal(true);
    });
  });

  describe("enable()", () => {
    it("should enable", async () => {
      const {referral} = await loadFixture(deploy);

      await referral.disable();

      const enabledBefore = await referral.enabled();

      await referral.enable();

      const enabledAfter = await referral.enabled();

      expect(enabledBefore).to.be.equal(false);
      expect(enabledAfter).to.be.equal(true);
    });

    it("should not enable if has no access", async () => {
      const {referral, user} = await loadFixture(deploy);

      await referral.disable();

      const enabledBefore = await referral.enabled();

      const tx = referral.connect(user).enable();

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const enabledAfter = await referral.enabled();

      expect(enabledBefore).to.be.equal(false);
      expect(enabledAfter).to.be.equal(false);
    });
  });

  describe("disableNew()", () => {
    it("should disable new", async () => {
      const {referral} = await loadFixture(deploy);
      const enabledNewBefore = await referral.enabledNew();

      await referral.disableNew();

      const enabledNewAfter = await referral.enabledNew();

      expect(enabledNewBefore).to.be.equal(true);
      expect(enabledNewAfter).to.be.equal(false);
    });

    it("should not disable new if has no access", async () => {
      const {referral, user} = await loadFixture(deploy);
      const enabledNewBefore = await referral.enabledNew();

      const tx = referral.connect(user).disableNew();

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const enabledNewAfter = await referral.enabledNew();

      expect(enabledNewBefore).to.be.equal(true);
      expect(enabledNewAfter).to.be.equal(true);
    });
  });

  describe("enableNew()", () => {
    it("should enable new", async () => {
      const {referral} = await loadFixture(deploy);

      await referral.disableNew();

      const enabledNewBefore = await referral.enabledNew();

      await referral.enableNew();

      const enabledNewAfter = await referral.enabledNew();

      expect(enabledNewBefore).to.be.equal(false);
      expect(enabledNewAfter).to.be.equal(true);
    });

    it("should not enable new if has no access", async () => {
      const {referral, user} = await loadFixture(deploy);

      await referral.disableNew();

      const enabledNewBefore = await referral.enabledNew();

      const tx = referral.connect(user).enableNew();

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const enabledNewAfter = await referral.enabledNew();

      expect(enabledNewBefore).to.be.equal(false);
      expect(enabledNewAfter).to.be.equal(false);
    });
  });

  describe("updateVault()", () => {
    it("should update vault", async () => {
      const {referral, vault, user} = await loadFixture(deploy);
      const vaultBefore = await referral.vault();

      await referral.updateVault(user.address);

      const vaultAfter = await referral.vault();

      expect(vaultBefore).to.be.equal(vault.address);
      expect(vaultAfter).to.be.equal(user.address);
    });

    it("should not update vault if has no access", async () => {
      const {referral, vault, user} = await loadFixture(deploy);
      const vaultBefore = await referral.vault();

      const tx = referral.connect(user).updateVault(user.address);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const vaultAfter = await referral.vault();

      expect(vaultBefore).to.be.equal(vault.address);
      expect(vaultAfter).to.be.equal(vault.address);
    });
  });
});
