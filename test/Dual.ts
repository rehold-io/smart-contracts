/* eslint-disable @typescript-eslint/no-shadow */
import {expect} from "chai";
import {ethers} from "hardhat";
import {time, loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Referral, Token, Vault, DualFactory, MockV3Aggregator, PriceFeed, WETH} from "../typechain-types";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

const {BigNumber} = ethers;

const ZERO_ADDRESS = ethers.constants.AddressZero;
const AGGREGATOR_DECIMALS = 8;

const e18 = BigNumber.from(10).pow(18);

describe("dual", () => {
  async function deploy() {
    const [owner, user, inviterAddress, inviterAddress1, inviterAddress2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token");
    const btc = await Token.deploy("BTCB Token", "BTCB", 18);
    const usdt = await Token.deploy("Tether USD", "USDT", 6);

    const WETH = await ethers.getContractFactory("WETH");
    const weth = await WETH.deploy();

    const V3Aggregator = await ethers.getContractFactory("MockV3Aggregator");

    const aggregatorBTC = await V3Aggregator.deploy(AGGREGATOR_DECIMALS, 20000 * 1e8);
    const aggregatorWETH = await V3Aggregator.deploy(AGGREGATOR_DECIMALS, 1300 * 1e8);
    const aggregatorUSDT = await V3Aggregator.deploy(AGGREGATOR_DECIMALS, 1e8);

    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(weth.address);

    const PriceFeed = await ethers.getContractFactory("PriceFeed");
    const priceFeed = await PriceFeed.deploy();

    await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);
    await priceFeed.updateAggregator(weth.address, aggregatorWETH.address);
    await priceFeed.updateAggregator(usdt.address, aggregatorUSDT.address);

    const Referral = await ethers.getContractFactory("Referral");
    const referral = await Referral.deploy(vault.address, usdt.address);

    const Dual = await ethers.getContractFactory("DualFactory");
    const dual = await Dual.deploy(vault.address, priceFeed.address, referral.address, weth.address, usdt.address);

    await referral.grantRole(await referral.DEFAULT_ADMIN_ROLE(), dual.address);
    await vault.grantRole(await referral.DEFAULT_ADMIN_ROLE(), dual.address);

    await dual.updateLimits(btc.address, {
      minAmount: e18.div(100),
      maxAmount: e18.mul(5),
    });

    await dual.updateLimits(usdt.address, {
      minAmount: 100 * 1e6,
      maxAmount: 50000 * 1e6,
    });

    await dual.updateLimits(weth.address, {
      minAmount: e18.div(10),
      maxAmount: e18.mul(50),
    });

    return {
      dual: dual as DualFactory,
      vault: vault as Vault,
      referral: referral as Referral,
      priceFeed: priceFeed as PriceFeed,

      btc: btc as Token,
      weth: weth as WETH,
      usdt: usdt as Token,

      owner,
      user,

      inviterAddress,
      inviterAddress1,
      inviterAddress2,

      aggregatorBTC: aggregatorBTC as MockV3Aggregator,
      aggregatorWETH: aggregatorWETH as MockV3Aggregator,
      aggregatorUSDT: aggregatorUSDT as MockV3Aggregator,
    };
  }

  describe("constructor()", () => {
    it("should set the right access", async () => {
      const {vault, owner, user} = await loadFixture(deploy);

      expect(await vault.hasRole(await vault.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);

      expect(await vault.hasRole(await vault.DEFAULT_ADMIN_ROLE(), user.address)).to.equal(false);
    });
  });

  describe("limits", () => {
    it("get", async () => {
      const {dual, btc, usdt, weth} = await loadFixture(deploy);

      const limits = await dual.limits();

      expect(limits.length).eq(3);
      expect(limits[0].token).eq(btc.address);
      expect(limits[0].minAmount).eq(e18.div(100));
      expect(limits[0].maxAmount).eq(e18.mul(5));
      expect(limits[1].token).eq(usdt.address);
      expect(limits[1].minAmount).eq(100 * 1e6);
      expect(limits[1].maxAmount).eq(50000 * 1e6);
      expect(limits[2].token).eq(weth.address);
      expect(limits[2].minAmount).eq(e18.div(10));
      expect(limits[2].maxAmount).eq(e18.mul(50));
    });
  });

  describe("validate", () => {
    let dual: DualFactory;
    let vault: Vault;
    let btc: Token;
    let usdt: Token;
    let user: SignerWithAddress;
    let inviterAddress: SignerWithAddress;

    before(async () => {
      ({dual, vault, btc, usdt, user, inviterAddress} = await loadFixture(deploy));

      await vault.updateThreshold(btc.address, e18);

      await dual.addTariff({
        baseToken: btc.address,
        quoteToken: usdt.address,
        stakingPeriod: 12,
        yield: 0.005 * 1e8,
        enabled: true,
        id: 0,
      });

      await btc.transfer(user.address, e18);
      await btc.connect(user).approve(vault.address, e18);
    });

    it("less than min amount", async () => {
      await dual.updateLimits(btc.address, {
        minAmount: e18.div(100),
        maxAmount: e18.mul(5),
      });

      await expect(
        dual.connect(user).create(0, user.address, btc.address, e18.div(101), inviterAddress.address),
      ).revertedWith("Dual: Too small input amount");
    });

    it("greater than max amount", async () => {
      await dual.updateLimits(btc.address, {
        minAmount: e18.div(100),
        maxAmount: e18.mul(5),
      });

      await expect(
        dual.connect(user).create(0, user.address, btc.address, e18.mul(6), inviterAddress.address),
      ).revertedWith("Dual: Exceeds maximum input amount");
    });

    it("tariff disabled", async () => {
      await dual.disableTariff(0);
      await expect(dual.create(0, user.address, btc.address, e18, inviterAddress.address)).revertedWith(
        "Dual: Tariff does not exist",
      );
    });

    it("dual disabled", async () => {
      await dual.disable();
      await expect(dual.create(0, user.address, btc.address, e18, inviterAddress.address)).revertedWith(
        "Dual: Creating new duals is unavailable now",
      );
    });
  });

  describe("admin manage duals", () => {
    let dual: DualFactory;
    let vault: Vault;
    let btc: Token;
    let usdt: Token;
    let user: SignerWithAddress;
    let inviterAddress: SignerWithAddress;
    let aggregatorBTC: MockV3Aggregator;

    describe("only user or admin", () => {
      before(async () => {
        ({dual, vault, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

        await vault.updateThreshold(btc.address, e18);

        await dual.addTariff({
          baseToken: btc.address,
          quoteToken: usdt.address,
          stakingPeriod: 12,
          yield: 0.005 * 1e8,
          enabled: true,
          id: 0,
        });
      });

      it("forbidden creating from another user or admin", async () => {
        await btc.transfer(user.address, e18);
        await btc.connect(user).approve(vault.address, e18);

        await expect(dual.connect(inviterAddress).create(0, user.address, btc.address, e18, user.address)).revertedWith(
          "Dual: Not Allowed",
        );
      });

      it("forbidden claim from another user or admin", async () => {
        await btc.transfer(user.address, e18);
        await btc.connect(user).approve(vault.address, e18);

        await dual.connect(user).create(0, user.address, btc.address, e18, user.address);

        await aggregatorBTC.updateAnswer(21000 * 1e8);
        await time.increase(12 * 60 * 60);

        await expect(dual.connect(inviterAddress).claim(0, 2, 1)).revertedWith("Dual: Access denied");
      });

      it("forbidden replay from another user or admin", async () => {
        await btc.transfer(user.address, e18);
        await btc.connect(user).approve(vault.address, e18);

        await dual.connect(user).create(0, user.address, btc.address, e18, user.address);

        await aggregatorBTC.updateAnswer(21000 * 1e8);
        await time.increase(12 * 60 * 60);

        await expect(dual.connect(inviterAddress).replay(0, 0, 2, 1)).revertedWith("Dual: Access denied");
      });
    });

    describe("create by user, claim by admin", () => {
      before(async () => {
        ({dual, vault, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

        await vault.updateThreshold(btc.address, e18);

        await dual.addTariff({
          baseToken: btc.address,
          quoteToken: usdt.address,
          stakingPeriod: 12,
          yield: 0.005 * 1e8,
          enabled: true,
          id: 0,
        });

        await btc.transfer(user.address, e18);
        await btc.connect(user).approve(vault.address, e18);
      });

      it("create by user", async () => {
        await dual.connect(user).create(0, user.address, btc.address, e18, user.address);

        const userDual = await dual.get(0);
        expect(userDual.user, user.address);
      });

      it("claim by admin", async () => {
        await aggregatorBTC.updateAnswer(21000 * 1e8);
        await time.increase(12 * 60 * 60);
        await usdt.transfer(vault.address, 20100 * 1e6);

        const userBalanceBefore = await usdt.balanceOf(user.address);

        await dual.claim(0, 2, 1);
        const closedDual = await dual.get(0);

        const userBalanceAfter = await usdt.balanceOf(user.address);

        expect(userBalanceBefore).eq(0);
        expect(userBalanceAfter).eq(20100 * 1e6);
        expect(closedDual.user).eq(user.address);
      });
    });

    describe("create by user, replay by admin", () => {
      before(async () => {
        ({dual, vault, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

        await vault.updateThreshold(btc.address, e18);

        await dual.addTariff({
          baseToken: btc.address,
          quoteToken: usdt.address,
          stakingPeriod: 12,
          yield: 0.005 * 1e8,
          enabled: true,
          id: 0,
        });

        await btc.transfer(user.address, e18);
        await btc.connect(user).approve(vault.address, e18);
        await usdt.transfer(vault.address, 20100 * 1e6);
      });

      it("create by user", async () => {
        await dual.connect(user).create(0, user.address, btc.address, e18, user.address);

        const userDual = await dual.get(0);
        expect(userDual.user, user.address);
      });

      it("replay by admin", async () => {
        await aggregatorBTC.updateAnswer(21000 * 1e8);
        await time.increase(12 * 60 * 60);

        const userBalanceBefore = await usdt.balanceOf(user.address);

        await dual.replay(0, 0, 2, 1);
        const closedDual = await dual.get(0);
        const replayedDual = await dual.get(1);

        const userBalanceAfter = await usdt.balanceOf(user.address);

        expect(userBalanceBefore).eq(0);
        expect(userBalanceAfter).eq(0);
        expect(closedDual.user).eq(user.address);
        expect(replayedDual.user).eq(user.address);
        expect(replayedDual.inputToken).eq(usdt.address);
        expect(replayedDual.inputAmount).eq(20100 * 1e6);
      });
    });

    describe("create by admin, claim by user", () => {
      before(async () => {
        ({dual, vault, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

        await vault.updateThreshold(btc.address, e18);

        await dual.addTariff({
          baseToken: btc.address,
          quoteToken: usdt.address,
          stakingPeriod: 12,
          yield: 0.005 * 1e8,
          enabled: true,
          id: 0,
        });

        await btc.transfer(user.address, e18);
        await btc.connect(user).approve(vault.address, e18);
      });

      it("create by admin", async () => {
        const userBalanceBefore = await btc.balanceOf(user.address);
        await dual.create(0, user.address, btc.address, e18, user.address);

        const userBalanceAfter = await btc.balanceOf(user.address);

        const userDual = await dual.get(0);
        expect(userDual.user, user.address);
        expect(userBalanceBefore).eq(e18);
        expect(userBalanceAfter).eq(0);
      });

      it("claim by admin", async () => {
        await aggregatorBTC.updateAnswer(21000 * 1e8);
        await time.increase(12 * 60 * 60);
        await usdt.transfer(vault.address, 20100 * 1e6);

        const userBalanceBefore = await usdt.balanceOf(user.address);

        await dual.connect(user).claim(0, 2, 1);
        const closedDual = await dual.get(0);

        const userBalanceAfter = await usdt.balanceOf(user.address);

        expect(userBalanceBefore).eq(0);
        expect(userBalanceAfter).eq(20100 * 1e6);
        expect(closedDual.user).eq(user.address);
      });
    });

    describe("create by admin, replay by user", () => {
      before(async () => {
        ({dual, vault, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

        await vault.updateThreshold(btc.address, e18);

        await dual.addTariff({
          baseToken: btc.address,
          quoteToken: usdt.address,
          stakingPeriod: 12,
          yield: 0.005 * 1e8,
          enabled: true,
          id: 0,
        });

        await btc.transfer(user.address, e18);
        await btc.connect(user).approve(vault.address, e18);
      });

      it("create by admin", async () => {
        const userBalanceBefore = await btc.balanceOf(user.address);

        await dual.create(0, user.address, btc.address, e18, user.address);

        const userBalanceAfter = await btc.balanceOf(user.address);

        const userDual = await dual.get(0);
        expect(userDual.user, user.address);
        expect(userBalanceBefore).eq(e18);
        expect(userBalanceAfter).eq(0);
      });

      it("replay by user", async () => {
        await aggregatorBTC.updateAnswer(21000 * 1e8);
        await time.increase(12 * 60 * 60);
        await usdt.transfer(vault.address, 20100 * 1e6);

        const userBalanceBefore = await usdt.balanceOf(user.address);

        await dual.connect(user).replay(0, 0, 2, 1);
        const closedDual = await dual.get(0);
        const replayedDual = await dual.get(1);

        const userBalanceAfter = await usdt.balanceOf(user.address);

        expect(userBalanceBefore).eq(0);
        expect(userBalanceAfter).eq(0);
        expect(closedDual.user).eq(user.address);
        expect(replayedDual.user).eq(user.address);
        expect(replayedDual.inputAmount).eq(20100 * 1e6);
      });
    });

    describe("create by admin, claim by admin", () => {
      before(async () => {
        ({dual, vault, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

        await vault.updateThreshold(btc.address, e18);

        await dual.addTariff({
          baseToken: btc.address,
          quoteToken: usdt.address,
          stakingPeriod: 12,
          yield: 0.005 * 1e8,
          enabled: true,
          id: 0,
        });

        await btc.transfer(user.address, e18);
        await btc.connect(user).approve(vault.address, e18);
      });

      it("create by admin", async () => {
        const userBalanceBefore = await btc.balanceOf(user.address);

        await dual.create(0, user.address, btc.address, e18, user.address);

        const userBalanceAfter = await btc.balanceOf(user.address);

        const userDual = await dual.get(0);
        expect(userDual.user, user.address);
        expect(userBalanceBefore).eq(e18);
        expect(userBalanceAfter).eq(0);
      });

      it("claim by admin", async () => {
        await aggregatorBTC.updateAnswer(21000 * 1e8);
        await time.increase(12 * 60 * 60);
        await usdt.transfer(vault.address, 20100 * 1e6);

        const userBalanceBefore = await usdt.balanceOf(user.address);

        await dual.claim(0, 2, 1);
        const closedDual = await dual.get(0);

        const userBalanceAfter = await usdt.balanceOf(user.address);

        expect(userBalanceBefore).eq(0);
        expect(userBalanceAfter).eq(20100 * 1e6);
        expect(closedDual.user).eq(user.address);
      });
    });

    describe("create by admin, replay by admin", () => {
      before(async () => {
        ({dual, vault, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

        await vault.updateThreshold(btc.address, e18);

        await dual.addTariff({
          baseToken: btc.address,
          quoteToken: usdt.address,
          stakingPeriod: 12,
          yield: 0.005 * 1e8,
          enabled: true,
          id: 0,
        });

        await btc.transfer(user.address, e18);
        await btc.connect(user).approve(vault.address, e18);
      });

      it("create by admin", async () => {
        const userBalanceBefore = await btc.balanceOf(user.address);

        await dual.create(0, user.address, btc.address, e18, user.address);

        const userBalanceAfter = await btc.balanceOf(user.address);

        const userDual = await dual.get(0);
        expect(userDual.user, user.address);
        expect(userBalanceBefore).eq(e18);
        expect(userBalanceAfter).eq(0);
      });

      it("replay by admin", async () => {
        await aggregatorBTC.updateAnswer(21000 * 1e8);
        await time.increase(12 * 60 * 60);
        await usdt.transfer(vault.address, 20100 * 1e6);

        const userBalanceBefore = await usdt.balanceOf(user.address);

        await dual.replay(0, 0, 2, 1);
        const closedDual = await dual.get(0);
        const replayedDual = await dual.get(1);

        const userBalanceAfter = await usdt.balanceOf(user.address);

        expect(userBalanceBefore).eq(0);
        expect(userBalanceAfter).eq(0);
        expect(closedDual.user).eq(user.address);
        expect(replayedDual.user).eq(user.address);
        expect(replayedDual.inputAmount).eq(20100 * 1e6);
      });
    });
  });

  describe("input = base w/ up direction", () => {
    describe("create", () => {
      describe("claimed", () => {
        describe("referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let btc: Token;
          let usdt: Token;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let inviterAddress1: SignerWithAddress;
          let aggregatorBTC: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, btc, usdt, user, inviterAddress, inviterAddress1, aggregatorBTC} =
              await loadFixture(deploy));

            await vault.updateThreshold(btc.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).create(0, user.address, btc.address, e18, inviterAddress.address);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(10 * 1e6);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("inviter can't be overriden", async () => {
            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterAddressBefore = await referral.users(user.address);
            const inviter1Before = await referral.inviters(inviterAddress1.address);
            const originInviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).create(0, user.address, btc.address, e18, inviterAddress1.address);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAddressAfter = await referral.users(user.address);
            const inviter1After = await referral.inviters(inviterAddress1.address);
            const originInviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(e18);
            expect(vaultBalanceAfter).eq(e18.mul(2));

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(inviterAddress.address);
            expect(inviterAddressAfter).eq(inviterAddress.address);

            expect(inviter1Before.unclaimedBalance).eq(0);
            expect(inviter1Before.claimedBalance).eq(0);
            expect(inviter1Before.revShareFee).eq(0);
            expect(inviter1Before.level).eq(0);

            expect(inviter1After.unclaimedBalance).eq(0);
            expect(inviter1After.claimedBalance).eq(0);
            expect(inviter1After.revShareFee).eq(0);
            expect(inviter1After.level).eq(0);

            expect(originInviterBefore.unclaimedBalance).eq(10 * 1e6);
            expect(originInviterBefore.claimedBalance).eq(0);
            expect(originInviterBefore.revShareFee).eq(0);
            expect(originInviterBefore.level).eq(0);

            expect(originInviterAfter.unclaimedBalance).eq(20 * 1e6);
            expect(originInviterAfter.claimedBalance).eq(0);
            expect(originInviterAfter.revShareFee).eq(0);
            expect(originInviterAfter.level).eq(0);
          });

          it("claim is not ready", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Not finished yet");
          });

          it("claim", async () => {
            await aggregatorBTC.updateAnswer(21000 * 1e8);
            await time.increase(12 * 60 * 60);
            await usdt.transfer(vault.address, 20100 * 1e6);

            const userBalanceBefore = await usdt.balanceOf(user.address);
            const vaultBalanceBefore = await usdt.balanceOf(vault.address);

            await dual.connect(user).claim(0, 2, 1);

            const userBalanceAfter = await usdt.balanceOf(user.address);
            const vaultBalanceAfter = await usdt.balanceOf(vault.address);
            const closedDual = await dual.get(0);

            expect(userBalanceBefore).eq(0);
            expect(userBalanceAfter).eq(20100 * 1e6);

            expect(vaultBalanceBefore).eq(20100 * 1e6);
            expect(vaultBalanceAfter).eq(0);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(btc.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(btc.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(20000 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(21000 * 1e6);
            expect(closedDual.outputToken).eq(usdt.address);
            expect(closedDual.outputAmount).eq(20100 * 1e6);
          });

          it("should not be double claimed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });

          it("should not be replayed after claimed", async () => {
            await expect(dual.connect(user).replay(0, 0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });
        });

        describe("non-referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let btc: Token;
          let usdt: Token;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let aggregatorBTC: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

            await vault.updateThreshold(btc.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterAddressBefore = await referral.users(user.address);

            await dual.create(0, user.address, btc.address, e18, ZERO_ADDRESS);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAddressAfter = await referral.users(user.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(ZERO_ADDRESS);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("claim is not ready", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Not finished yet");
          });

          it("inviter can't be overriden", async () => {
            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterAddressBefore = await referral.users(user.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).create(0, user.address, btc.address, e18, inviterAddress.address);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAddressAfter = await referral.users(user.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(e18);
            expect(vaultBalanceAfter).eq(e18.mul(2));

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(referral.address);
            expect(inviterAddressAfter).eq(referral.address);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(0);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("claim", async () => {
            await aggregatorBTC.updateAnswer(21000 * 1e8);
            await time.increase(12 * 60 * 60);
            await usdt.transfer(vault.address, 20100 * 1e6);

            const userBalanceBefore = await usdt.balanceOf(user.address);
            const vaultBalanceBefore = await usdt.balanceOf(vault.address);

            await dual.connect(user).claim(0, 2, 1);

            const userBalanceAfter = await usdt.balanceOf(user.address);
            const vaultBalanceAfter = await usdt.balanceOf(vault.address);
            const closedDual = await dual.get(0);

            expect(userBalanceBefore).eq(0);
            expect(userBalanceAfter).eq(20100 * 1e6);

            expect(vaultBalanceBefore).eq(20100 * 1e6);
            expect(vaultBalanceAfter).eq(0);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(btc.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(btc.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(20000 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(21000 * 1e6);
            expect(closedDual.outputToken).eq(usdt.address);
            expect(closedDual.outputAmount).eq(20100 * 1e6);
          });

          it("should not be double claimed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });

          it("should not be replayed after claimed", async () => {
            await expect(dual.connect(user).replay(0, 0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });
        });
      });

      describe("replayed", () => {
        describe("referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let btc: Token;
          let usdt: Token;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let aggregatorBTC: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

            await vault.updateThreshold(btc.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).create(0, user.address, btc.address, e18, inviterAddress.address);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(10 * 1e6);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("replay is not ready", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Not finished yet");
          });

          it("replay", async () => {
            await aggregatorBTC.updateAnswer(21000 * 1e8);
            await time.increase(12 * 60 * 60);

            const inviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).replay(0, 0, 2, 1);

            const inviterAfter = await referral.inviters(inviterAddress.address);
            const closedDual = await dual.get(0);
            const replayedDual = await dual.get(1);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(btc.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(btc.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(20000 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(21000 * 1e6);
            expect(closedDual.outputToken).eq(usdt.address);
            expect(closedDual.outputAmount).eq(20100 * 1e6);

            expect(replayedDual.id).eq(1);
            expect(replayedDual.user).eq(user.address);
            expect(replayedDual.tariffId).eq(0);
            expect(replayedDual.baseToken).eq(btc.address);
            expect(replayedDual.quoteToken).eq(usdt.address);
            expect(replayedDual.inputToken).eq(usdt.address);
            expect(replayedDual.inputAmount).eq(20100 * 1e6);
            expect(replayedDual.inputBaseAmount).eq(0);
            expect(replayedDual.inputQuoteAmount).eq(20100 * 1e6);
            expect(replayedDual.stakingPeriod).eq(12);
            expect(replayedDual.yield).eq(0.005 * 1e8);
            expect(replayedDual.initialPrice).eq(21000 * 1e6);
            expect(replayedDual.claimed).eq(false);
            expect(replayedDual.closedPrice).eq(0);
            expect(replayedDual.outputToken).eq(ZERO_ADDRESS);
            expect(replayedDual.outputAmount).eq(0);

            expect(inviterBefore.unclaimedBalance).eq(10 * 1e6);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(20.05 * 1e6);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("should not be double replayed", async () => {
            await expect(dual.connect(user).replay(0, 0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });

          it("should not be claimed after replayed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });
        });

        describe("non-referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let btc: Token;
          let usdt: Token;
          let user: SignerWithAddress;
          let aggregatorBTC: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, btc, usdt, user, aggregatorBTC} = await loadFixture(deploy));

            await vault.updateThreshold(btc.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterAddressBefore = await referral.users(user.address);

            await dual.create(0, user.address, btc.address, e18, ZERO_ADDRESS);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAddressAfter = await referral.users(user.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(ZERO_ADDRESS);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("replay is not ready", async () => {
            await expect(dual.connect(user).replay(0, 0, 2, 1)).revertedWith("Dual: Not finished yet");
          });

          it("replay", async () => {
            await aggregatorBTC.updateAnswer(21000 * 1e8);
            await time.increase(12 * 60 * 60);

            const inviterAddressBefore = await referral.users(user.address);

            await dual.connect(user).replay(0, 0, 2, 1);

            const inviterAddressAfter = await referral.users(user.address);
            const closedDual = await dual.get(0);
            const replayedDual = await dual.get(1);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(btc.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(btc.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(20000 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(21000 * 1e6);
            expect(closedDual.outputToken).eq(usdt.address);
            expect(closedDual.outputAmount).eq(20100 * 1e6);

            expect(replayedDual.id).eq(1);
            expect(replayedDual.user).eq(user.address);
            expect(replayedDual.tariffId).eq(0);
            expect(replayedDual.baseToken).eq(btc.address);
            expect(replayedDual.quoteToken).eq(usdt.address);
            expect(replayedDual.inputToken).eq(usdt.address);
            expect(replayedDual.inputAmount).eq(20100 * 1e6);
            expect(replayedDual.inputBaseAmount).eq(0);
            expect(replayedDual.inputQuoteAmount).eq(20100 * 1e6);
            expect(replayedDual.stakingPeriod).eq(12);
            expect(replayedDual.yield).eq(0.005 * 1e8);
            expect(replayedDual.initialPrice).eq(21000 * 1e6);
            expect(replayedDual.claimed).eq(false);
            expect(replayedDual.closedPrice).eq(0);
            expect(replayedDual.outputToken).eq(ZERO_ADDRESS);
            expect(replayedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(referral.address);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("should not be double replayed", async () => {
            await expect(dual.connect(user).replay(0, 0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });

          it("should not be claimed after replayed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });
        });

        describe("different tariff", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let btc: Token;
          let usdt: Token;
          let weth: WETH;
          let user: SignerWithAddress;
          let aggregatorBTC: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, btc, weth, usdt, user, aggregatorBTC} = await loadFixture(deploy));

            await vault.updateThreshold(btc.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterAddressBefore = await referral.users(user.address);

            await dual.create(0, user.address, btc.address, e18, ZERO_ADDRESS);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAddressAfter = await referral.users(user.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(ZERO_ADDRESS);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("replay is not ready", async () => {
            await expect(dual.connect(user).replay(0, 0, 2, 1)).revertedWith("Dual: Not finished yet");
          });

          it("no replay with bad tariff", async () => {
            await aggregatorBTC.updateAnswer(21000 * 1e8);
            await time.increase(12 * 60 * 60);

            await dual.addTariff({
              baseToken: weth.address,
              quoteToken: btc.address,
              stakingPeriod: 24,
              yield: 0.007 * 1e8,
              enabled: true,
              id: 0,
            });

            await expect(dual.connect(user).replay(0, 1, 2, 1)).revertedWith("Dual: Input must be one from pair");
          });

          it("replay", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 24,
              yield: 0.007 * 1e8,
              enabled: true,
              id: 0,
            });

            const inviterAddressBefore = await referral.users(user.address);

            await dual.connect(user).replay(0, 2, 2, 1);

            const inviterAddressAfter = await referral.users(user.address);
            const closedDual = await dual.get(0);
            const replayedDual = await dual.get(1);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(btc.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(btc.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(20000 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(21000 * 1e6);
            expect(closedDual.outputToken).eq(usdt.address);
            expect(closedDual.outputAmount).eq(20100 * 1e6);

            expect(replayedDual.id).eq(1);
            expect(replayedDual.user).eq(user.address);
            expect(replayedDual.tariffId).eq(2);
            expect(replayedDual.baseToken).eq(btc.address);
            expect(replayedDual.quoteToken).eq(usdt.address);
            expect(replayedDual.inputToken).eq(usdt.address);
            expect(replayedDual.inputAmount).eq(20100 * 1e6);
            expect(replayedDual.inputBaseAmount).eq(0);
            expect(replayedDual.inputQuoteAmount).eq(20100 * 1e6);
            expect(replayedDual.stakingPeriod).eq(24);
            expect(replayedDual.yield).eq(0.007 * 1e8);
            expect(replayedDual.initialPrice).eq(21000 * 1e6);
            expect(replayedDual.claimed).eq(false);
            expect(replayedDual.closedPrice).eq(0);
            expect(replayedDual.outputToken).eq(ZERO_ADDRESS);
            expect(replayedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(referral.address);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("should not be double replayed", async () => {
            await expect(dual.connect(user).replay(0, 0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });

          it("should not be claimed after replayed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });
        });
      });
    });

    describe("native", () => {
      describe("claimed", () => {
        describe("referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let weth: WETH;
          let usdt: Token;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let aggregatorWETH: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, weth, usdt, user, inviterAddress, aggregatorWETH} = await loadFixture(deploy));

            await vault.updateThreshold(weth.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: weth.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            const tx = await dual.connect(user).createETH(0, inviterAddress.address, {value: e18});
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceAfter).eq(userBalanceBefore.sub(e18).sub(gasUsed));

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(weth.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(weth.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(1300 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(0.65 * 1e6);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("claim", async () => {
            await aggregatorWETH.updateAnswer(1400 * 1e8);
            await time.increase(12 * 60 * 60);
            await usdt.transfer(vault.address, 1306.5 * 1e6);

            const userBalanceBefore = await usdt.balanceOf(user.address);
            const vaultBalanceBefore = await usdt.balanceOf(vault.address);

            await dual.connect(user).claim(0, 2, 1);

            const userBalanceAfter = await usdt.balanceOf(user.address);
            const vaultBalanceAfter = await usdt.balanceOf(vault.address);
            const closedDual = await dual.get(0);

            expect(userBalanceBefore).eq(0);
            expect(userBalanceAfter).eq(1306.5 * 1e6);

            expect(vaultBalanceBefore).eq(1306.5 * 1e6);
            expect(vaultBalanceAfter).eq(0);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(weth.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(weth.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(1300 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(1400 * 1e6);
            expect(closedDual.outputToken).eq(usdt.address);
            expect(closedDual.outputAmount).eq(1306.5 * 1e6);
          });

          it("should not be double claimed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).revertedWith("Dual: Already claimed");
          });
        });

        describe("non-referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let weth: WETH;
          let usdt: Token;
          let user: SignerWithAddress;
          let aggregatorWETH: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, weth, usdt, user, aggregatorWETH} = await loadFixture(deploy));

            await vault.updateThreshold(weth.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: weth.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);
            const inviterAddressBefore = await referral.users(user.address);

            const tx = await dual.connect(user).createETH(0, user.address, {value: e18});
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const inviterAddressAfter = await referral.users(user.address);

            expect(userBalanceAfter).eq(userBalanceBefore.sub(e18).sub(gasUsed));

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(weth.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(weth.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(1300 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(ZERO_ADDRESS);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("claim", async () => {
            await aggregatorWETH.updateAnswer(1400 * 1e8);
            await time.increase(12 * 60 * 60);
            await usdt.transfer(vault.address, 1306.5 * 1e6);

            const userBalanceBefore = await usdt.balanceOf(user.address);
            const vaultBalanceBefore = await usdt.balanceOf(vault.address);

            await dual.connect(user).claim(0, 2, 1);

            const userBalanceAfter = await usdt.balanceOf(user.address);
            const vaultBalanceAfter = await usdt.balanceOf(vault.address);
            const closedDual = await dual.get(0);

            expect(userBalanceBefore).eq(0);
            expect(userBalanceAfter).eq(1306.5 * 1e6);

            expect(vaultBalanceBefore).eq(1306.5 * 1e6);
            expect(vaultBalanceAfter).eq(0);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(weth.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(weth.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(1300 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(1400 * 1e6);
            expect(closedDual.outputToken).eq(usdt.address);
            expect(closedDual.outputAmount).eq(1306.5 * 1e6);
          });

          it("should not be double claimed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).revertedWith("Dual: Already claimed");
          });
        });
      });

      describe("replayed", () => {
        describe("referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let weth: WETH;
          let usdt: Token;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let aggregatorWETH: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, weth, usdt, user, inviterAddress, aggregatorWETH} = await loadFixture(deploy));

            await vault.updateThreshold(weth.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: weth.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            const tx = await dual.connect(user).createETH(0, inviterAddress.address, {value: e18});
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceAfter).eq(userBalanceBefore.sub(e18).sub(gasUsed));

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(weth.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(weth.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(1300 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(0.65 * 1e6);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("replay", async () => {
            await aggregatorWETH.updateAnswer(1400 * 1e8);
            await time.increase(12 * 60 * 60);

            const inviterAddressBefore = await referral.users(user.address);

            await dual.connect(user).replay(0, 0, 2, 1);

            const inviterAddressAfter = await referral.users(user.address);
            const closedDual = await dual.get(0);
            const replayedDual = await dual.get(1);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(weth.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(weth.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(1300 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(1400 * 1e6);
            expect(closedDual.outputToken).eq(usdt.address);
            expect(closedDual.outputAmount).eq(1306.5 * 1e6);

            expect(replayedDual.id).eq(1);
            expect(replayedDual.user).eq(user.address);
            expect(replayedDual.tariffId).eq(0);
            expect(replayedDual.baseToken).eq(weth.address);
            expect(replayedDual.quoteToken).eq(usdt.address);
            expect(replayedDual.inputToken).eq(usdt.address);
            expect(replayedDual.inputAmount).eq(1306.5 * 1e6);
            expect(replayedDual.inputBaseAmount).eq(0);
            expect(replayedDual.inputQuoteAmount).eq(1306.5 * 1e6);
            expect(replayedDual.stakingPeriod).eq(12);
            expect(replayedDual.yield).eq(0.005 * 1e8);
            expect(replayedDual.initialPrice).eq(1400 * 1e6);
            expect(replayedDual.claimed).eq(false);
            expect(replayedDual.closedPrice).eq(0);
            expect(replayedDual.outputToken).eq(ZERO_ADDRESS);
            expect(replayedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(inviterAddress.address);
            expect(inviterAddressAfter).eq(inviterAddress.address);
          });

          it("should not be double replayed", async () => {
            await expect(dual.connect(user).replay(0, 0, 2, 1)).revertedWith("Dual: Already claimed");
          });
        });

        describe("non-referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let weth: WETH;
          let usdt: Token;
          let user: SignerWithAddress;
          let aggregatorWETH: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, weth, usdt, user, aggregatorWETH} = await loadFixture(deploy));

            await vault.updateThreshold(weth.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: weth.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);
            const inviterAddressBefore = await referral.users(user.address);

            const tx = await dual.connect(user).createETH(0, ZERO_ADDRESS, {value: e18});
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const inviterAddressAfter = await referral.users(user.address);

            expect(userBalanceAfter).eq(userBalanceBefore.sub(e18).sub(gasUsed));

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(weth.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(weth.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(1300 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(ZERO_ADDRESS);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("replay", async () => {
            await aggregatorWETH.updateAnswer(1400 * 1e8);
            await time.increase(12 * 60 * 60);

            const inviterAddressBefore = await referral.users(user.address);

            await dual.connect(user).replay(0, 0, 2, 1);

            const inviterAddressAfter = await referral.users(user.address);
            const closedDual = await dual.get(0);
            const replayedDual = await dual.get(1);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(weth.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(weth.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(1300 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(1400 * 1e6);
            expect(closedDual.outputToken).eq(usdt.address);
            expect(closedDual.outputAmount).eq(1306.5 * 1e6);

            expect(replayedDual.id).eq(1);
            expect(replayedDual.user).eq(user.address);
            expect(replayedDual.tariffId).eq(0);
            expect(replayedDual.baseToken).eq(weth.address);
            expect(replayedDual.quoteToken).eq(usdt.address);
            expect(replayedDual.inputToken).eq(usdt.address);
            expect(replayedDual.inputAmount).eq(1306.5 * 1e6);
            expect(replayedDual.inputBaseAmount).eq(0);
            expect(replayedDual.inputQuoteAmount).eq(1306.5 * 1e6);
            expect(replayedDual.stakingPeriod).eq(12);
            expect(replayedDual.yield).eq(0.005 * 1e8);
            expect(replayedDual.initialPrice).eq(1400 * 1e6);
            expect(replayedDual.claimed).eq(false);
            expect(replayedDual.closedPrice).eq(0);
            expect(replayedDual.outputToken).eq(ZERO_ADDRESS);
            expect(replayedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(referral.address);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("should not be double replayed", async () => {
            await expect(dual.connect(user).replay(0, 0, 2, 1)).revertedWith("Dual: Already claimed");
          });
        });
      });
    });
  });

  describe("input = base w/ down direction", () => {
    describe("token", () => {
      describe("claimed", () => {
        describe("referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let btc: Token;
          let usdt: Token;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let aggregatorBTC: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

            await vault.updateThreshold(btc.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).create(0, user.address, btc.address, e18, inviterAddress.address);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(10 * 1e6);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("claim is not ready", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Not finished yet");
          });

          it("claim", async () => {
            await aggregatorBTC.updateAnswer(19000 * 1e8);
            await time.increase(12 * 60 * 60);
            await btc.transfer(vault.address, e18.mul(5).div(1000));

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);

            await dual.connect(user).claim(0, 2, 1);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const closedDual = await dual.get(0);

            expect(userBalanceBefore).eq(0);
            expect(userBalanceAfter).eq(e18.mul(1005).div(1000));

            expect(vaultBalanceBefore).eq(e18.mul(1005).div(1000));
            expect(vaultBalanceAfter).eq(0);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(btc.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(btc.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(20000 * 1e6);

            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(19000 * 1e6);
            expect(closedDual.outputToken).eq(btc.address);
            expect(closedDual.outputAmount).eq(e18.mul(1005).div(1000));
          });

          it("should not be double claimed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });
        });

        describe("non-referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let btc: Token;
          let usdt: Token;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let aggregatorBTC: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

            await vault.updateThreshold(btc.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterAddressBefore = await referral.users(user.address);

            await dual.create(0, user.address, btc.address, e18, ZERO_ADDRESS);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAddressAfter = await referral.users(user.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(ZERO_ADDRESS);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("claim is not ready", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Not finished yet");
          });

          it("inviter can't be overriden", async () => {
            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterAddressBefore = await referral.users(user.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).create(0, user.address, btc.address, e18, inviterAddress.address);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAddressAfter = await referral.users(user.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(e18);
            expect(vaultBalanceAfter).eq(e18.mul(2));

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(referral.address);
            expect(inviterAddressAfter).eq(referral.address);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(0);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("claim", async () => {
            await aggregatorBTC.updateAnswer(19000 * 1e8);
            await time.increase(12 * 60 * 60);
            await btc.transfer(vault.address, e18.mul(5).div(1000));

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);

            await dual.connect(user).claim(0, 2, 1);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const closedDual = await dual.get(0);

            expect(userBalanceBefore).eq(0);
            expect(userBalanceAfter).eq(e18.mul(1005).div(1000));

            expect(vaultBalanceBefore).eq(e18.mul(1005).div(1000).add(e18));
            expect(vaultBalanceAfter).eq(e18);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(btc.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(btc.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(20000 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(19000 * 1e6);
            expect(closedDual.outputToken).eq(btc.address);
            expect(closedDual.outputAmount).eq(e18.mul(1005).div(1000));
          });

          it("should not be double claimed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });
        });
      });
      describe("replayed", () => {
        describe("referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let btc: Token;
          let usdt: Token;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let aggregatorBTC: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

            await vault.updateThreshold(btc.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).create(0, user.address, btc.address, e18, inviterAddress.address);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(10 * 1e6);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("replay is not ready", async () => {
            await expect(dual.connect(user).replay(0, 0, 2, 1)).to.be.revertedWith("Dual: Not finished yet");
          });

          it("replay", async () => {
            await aggregatorBTC.updateAnswer(19000 * 1e8);
            await time.increase(12 * 60 * 60);
            await btc.transfer(vault.address, e18.mul(5).div(1000));

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);

            await dual.connect(user).replay(0, 0, 2, 1);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const closedDual = await dual.get(0);
            const replayedDual = await dual.get(1);

            expect(userBalanceBefore).eq(0);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(vaultBalanceAfter);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(btc.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(btc.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(20000 * 1e6);

            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(19000 * 1e6);
            expect(closedDual.outputToken).eq(btc.address);
            expect(closedDual.outputAmount).eq(e18.mul(1005).div(1000));

            expect(replayedDual.id).eq(1);
            expect(replayedDual.user).eq(user.address);
            expect(replayedDual.tariffId).eq(0);
            expect(replayedDual.baseToken).eq(btc.address);
            expect(replayedDual.quoteToken).eq(usdt.address);
            expect(replayedDual.inputToken).eq(btc.address);
            expect(replayedDual.inputAmount).eq(e18.mul(1005).div(1000));
            expect(replayedDual.inputBaseAmount).eq(e18.mul(1005).div(1000));
            expect(replayedDual.inputQuoteAmount).eq(0);
            expect(replayedDual.stakingPeriod).eq(12);
            expect(replayedDual.yield).eq(0.005 * 1e8);
            expect(replayedDual.initialPrice).eq(19000 * 1e6);

            expect(replayedDual.claimed).eq(false);
            expect(replayedDual.closedPrice).eq(0);
            expect(replayedDual.outputToken).eq(ZERO_ADDRESS);
            expect(replayedDual.outputAmount).eq(0);
          });

          it("should not be double claimed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });
        });

        describe("non-referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let btc: Token;
          let usdt: Token;
          let user: SignerWithAddress;
          let aggregatorBTC: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, btc, usdt, user, aggregatorBTC} = await loadFixture(deploy));

            await vault.updateThreshold(btc.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            await btc.transfer(user.address, e18);
            await btc.connect(user).approve(vault.address, e18);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);
            const inviterAddressBefore = await referral.users(user.address);

            await dual.create(0, user.address, btc.address, e18, ZERO_ADDRESS);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const inviterAddressAfter = await referral.users(user.address);

            expect(userBalanceBefore).eq(e18);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(btc.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(ZERO_ADDRESS);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("replay is not ready", async () => {
            await expect(dual.connect(user).replay(0, 0, 2, 1)).to.be.revertedWith("Dual: Not finished yet");
          });

          it("replay", async () => {
            await aggregatorBTC.updateAnswer(19000 * 1e8);
            await time.increase(12 * 60 * 60);

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);

            await dual.connect(user).replay(0, 0, 2, 1);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const closedDual = await dual.get(0);
            const replayedDual = await dual.get(1);

            expect(userBalanceBefore).eq(0);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(e18);
            expect(vaultBalanceAfter).eq(e18);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(btc.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(btc.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(20000 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(19000 * 1e6);
            expect(closedDual.outputToken).eq(btc.address);
            expect(closedDual.outputAmount).eq(e18.mul(1005).div(1000));

            expect(replayedDual.id).eq(1);
            expect(replayedDual.user).eq(user.address);
            expect(replayedDual.tariffId).eq(0);
            expect(replayedDual.baseToken).eq(btc.address);
            expect(replayedDual.quoteToken).eq(usdt.address);
            expect(replayedDual.inputToken).eq(btc.address);
            expect(replayedDual.inputAmount).eq(e18.mul(1005).div(1000));
            expect(replayedDual.inputBaseAmount).eq(e18.mul(1005).div(1000));
            expect(replayedDual.inputQuoteAmount).eq(0);
            expect(replayedDual.stakingPeriod).eq(12);
            expect(replayedDual.yield).eq(0.005 * 1e8);
            expect(replayedDual.initialPrice).eq(19000 * 1e6);
            expect(replayedDual.claimed).eq(false);
            expect(replayedDual.closedPrice).eq(0);
            expect(replayedDual.outputToken).eq(ZERO_ADDRESS);
            expect(replayedDual.outputAmount).eq(0);
          });

          it("should not be double claimed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });
        });
      });
    });

    describe("native", () => {
      describe("claimed", () => {
        describe("referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let weth: WETH;
          let usdt: Token;
          let owner: SignerWithAddress;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let aggregatorWETH: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, weth, usdt, user, owner, inviterAddress, aggregatorWETH} = await loadFixture(
              deploy,
            ));

            await vault.updateThreshold(weth.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: weth.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            const tx = await dual.connect(user).createETH(0, inviterAddress.address, {value: e18});
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceAfter).eq(userBalanceBefore.sub(e18).sub(gasUsed));

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(weth.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(weth.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(1300 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(0.65 * 1e6);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("claim", async () => {
            await aggregatorWETH.updateAnswer(1200 * 1e8);
            await time.increase(12 * 60 * 60);
            await owner.sendTransaction({to: vault.address, value: e18.mul(5).div(1000)});

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);

            const tx = await dual.connect(user).claim(0, 2, 1);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const closedDual = await dual.get(0);

            expect(userBalanceAfter).eq(userBalanceBefore.add(e18.mul(1005).div(1000)).sub(gasUsed));

            expect(vaultBalanceBefore).eq(e18.mul(1005).div(1000));
            expect(vaultBalanceAfter).eq(0);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(weth.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(weth.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(1300 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(1200 * 1e6);
            expect(closedDual.outputToken).eq(weth.address);
            expect(closedDual.outputAmount).eq(e18.mul(1005).div(1000));
          });
        });

        describe("non-referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let weth: WETH;
          let usdt: Token;
          let owner: SignerWithAddress;
          let user: SignerWithAddress;
          let aggregatorWETH: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, weth, usdt, user, owner, aggregatorWETH} = await loadFixture(deploy));

            await vault.updateThreshold(weth.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: weth.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);
            const inviterAddressBefore = await referral.users(user.address);

            const tx = await dual.connect(user).createETH(0, ZERO_ADDRESS, {value: e18});
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const inviterAddressAfter = await referral.users(user.address);

            expect(userBalanceAfter).eq(userBalanceBefore.sub(e18).sub(gasUsed));

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(weth.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(weth.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(1300 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(ZERO_ADDRESS);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("claim", async () => {
            await aggregatorWETH.updateAnswer(1200 * 1e8);
            await time.increase(12 * 60 * 60);
            await owner.sendTransaction({to: vault.address, value: e18.mul(5).div(1000)});

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);

            const tx = await dual.connect(user).claim(0, 2, 1);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const closedDual = await dual.get(0);

            expect(userBalanceAfter).eq(userBalanceBefore.add(e18.mul(1005).div(1000)).sub(gasUsed));

            expect(vaultBalanceBefore).eq(e18.mul(1005).div(1000));
            expect(vaultBalanceAfter).eq(0);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(weth.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(weth.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(1300 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(1200 * 1e6);
            expect(closedDual.outputToken).eq(weth.address);
            expect(closedDual.outputAmount).eq(e18.mul(1005).div(1000));
          });
        });
      });

      describe("replayed", () => {
        describe("referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let weth: WETH;
          let usdt: Token;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let aggregatorWETH: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, weth, usdt, user, inviterAddress, aggregatorWETH} = await loadFixture(deploy));

            await vault.updateThreshold(weth.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: weth.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            const tx = await dual.connect(user).createETH(0, inviterAddress.address, {value: e18});
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceAfter).eq(userBalanceBefore.sub(e18).sub(gasUsed));

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(weth.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(weth.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(1300 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(0.65 * 1e6);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("replay", async () => {
            await aggregatorWETH.updateAnswer(1200 * 1e8);
            await time.increase(12 * 60 * 60);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);

            const tx = await dual.connect(user).replay(0, 0, 2, 1);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const closedDual = await dual.get(0);
            const replayedDual = await dual.get(1);

            expect(userBalanceAfter).eq(userBalanceBefore.sub(gasUsed));

            expect(vaultBalanceBefore).eq(e18);
            expect(vaultBalanceAfter).eq(e18);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(weth.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(weth.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(1300 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(1200 * 1e6);
            expect(closedDual.outputToken).eq(weth.address);
            expect(closedDual.outputAmount).eq(e18.mul(1005).div(1000));

            expect(replayedDual.id).eq(1);
            expect(replayedDual.user).eq(user.address);
            expect(replayedDual.tariffId).eq(0);
            expect(replayedDual.baseToken).eq(weth.address);
            expect(replayedDual.quoteToken).eq(usdt.address);
            expect(replayedDual.inputToken).eq(weth.address);
            expect(replayedDual.inputAmount).eq(e18.mul(1005).div(1000));
            expect(replayedDual.inputBaseAmount).eq(e18.mul(1005).div(1000));
            expect(replayedDual.inputQuoteAmount).eq(0);
            expect(replayedDual.stakingPeriod).eq(12);
            expect(replayedDual.yield).eq(0.005 * 1e8);
            expect(replayedDual.initialPrice).eq(1200 * 1e6);
            expect(replayedDual.claimed).eq(false);
            expect(replayedDual.closedPrice).eq(0);
            expect(replayedDual.outputToken).eq(ZERO_ADDRESS);
            expect(replayedDual.outputAmount).eq(0);
          });
        });

        describe("non-referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let weth: WETH;
          let usdt: Token;
          let user: SignerWithAddress;
          let aggregatorWETH: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, weth, usdt, user, aggregatorWETH} = await loadFixture(deploy));

            await vault.updateThreshold(weth.address, e18);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: weth.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);
            const inviterAddressBefore = await referral.users(user.address);

            const tx = await dual.connect(user).createETH(0, ZERO_ADDRESS, {value: e18});
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const inviterAddressAfter = await referral.users(user.address);

            expect(userBalanceAfter).eq(userBalanceBefore.sub(e18).sub(gasUsed));

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(e18);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(weth.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(weth.address);
            expect(openedDual.inputAmount).eq(e18);
            expect(openedDual.inputBaseAmount).eq(e18);
            expect(openedDual.inputQuoteAmount).eq(0);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(1300 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(ZERO_ADDRESS);
            expect(inviterAddressAfter).eq(referral.address);
          });

          it("replay", async () => {
            await aggregatorWETH.updateAnswer(1200 * 1e8);
            await time.increase(12 * 60 * 60);

            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);

            const tx = await dual.connect(user).replay(0, 0, 2, 1);
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

            const userBalanceAfter = await ethers.provider.getBalance(user.address);
            const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
            const closedDual = await dual.get(0);
            const replayedDual = await dual.get(1);

            expect(userBalanceAfter).eq(userBalanceBefore.sub(gasUsed));

            expect(vaultBalanceBefore).eq(e18);
            expect(vaultBalanceAfter).eq(e18);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(weth.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(weth.address);
            expect(closedDual.inputAmount).eq(e18);
            expect(closedDual.inputBaseAmount).eq(e18);
            expect(closedDual.inputQuoteAmount).eq(0);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(1300 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(1200 * 1e6);
            expect(closedDual.outputToken).eq(weth.address);
            expect(closedDual.outputAmount).eq(e18.mul(1005).div(1000));

            expect(replayedDual.id).eq(1);
            expect(replayedDual.user).eq(user.address);
            expect(replayedDual.tariffId).eq(0);
            expect(replayedDual.baseToken).eq(weth.address);
            expect(replayedDual.quoteToken).eq(usdt.address);
            expect(replayedDual.inputToken).eq(weth.address);
            expect(replayedDual.inputAmount).eq(e18.mul(1005).div(1000));
            expect(replayedDual.inputBaseAmount).eq(e18.mul(1005).div(1000));
            expect(replayedDual.inputQuoteAmount).eq(0);
            expect(replayedDual.stakingPeriod).eq(12);
            expect(replayedDual.yield).eq(0.005 * 1e8);
            expect(replayedDual.initialPrice).eq(1200 * 1e6);
            expect(replayedDual.claimed).eq(false);
            expect(replayedDual.closedPrice).eq(0);
            expect(replayedDual.outputToken).eq(ZERO_ADDRESS);
            expect(replayedDual.outputAmount).eq(0);
          });
        });
      });
    });
  });

  describe("input = quote w/ up direction", () => {
    describe("token", () => {
      describe("claimed", () => {
        describe("referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let btc: Token;
          let usdt: Token;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let inviterAddress1: SignerWithAddress;
          let aggregatorBTC: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, btc, usdt, user, inviterAddress, inviterAddress1, aggregatorBTC} =
              await loadFixture(deploy));

            await vault.updateThreshold(usdt.address, 20000 * 1e6);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            await usdt.transfer(user.address, 20000 * 1e6);
            await usdt.connect(user).approve(vault.address, 20000 * 1e6);

            const userBalanceBefore = await usdt.balanceOf(user.address);
            const vaultBalanceBefore = await usdt.balanceOf(vault.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).create(0, user.address, usdt.address, 20000 * 1e6, inviterAddress.address);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await usdt.balanceOf(user.address);
            const vaultBalanceAfter = await usdt.balanceOf(vault.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceBefore).eq(20000 * 1e6);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(20000 * 1e6);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(usdt.address);
            expect(openedDual.inputAmount).eq(20000 * 1e6);
            expect(openedDual.inputBaseAmount).eq(0);
            expect(openedDual.inputQuoteAmount).eq(20000 * 1e6);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(10 * 1e6);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("inviter can't be overriden", async () => {
            await usdt.transfer(user.address, 20000 * 1e6);
            await usdt.connect(user).approve(vault.address, 20000 * 1e6);

            const userBalanceBefore = await usdt.balanceOf(user.address);
            const vaultBalanceBefore = await usdt.balanceOf(vault.address);
            const inviterAddressBefore = await referral.users(user.address);
            const inviter1Before = await referral.inviters(inviterAddress1.address);
            const originInviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).create(0, user.address, usdt.address, 20000 * 1e6, inviterAddress1.address);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await usdt.balanceOf(user.address);
            const vaultBalanceAfter = await usdt.balanceOf(vault.address);
            const inviterAddressAfter = await referral.users(user.address);
            const inviter1After = await referral.inviters(inviterAddress1.address);
            const originInviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceBefore).eq(20000 * 1e6);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(20000 * 1e6);
            expect(vaultBalanceAfter).eq(40000 * 1e6);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(usdt.address);
            expect(openedDual.inputAmount).eq(20000 * 1e6);
            expect(openedDual.inputBaseAmount).eq(0);
            expect(openedDual.inputQuoteAmount).eq(20000 * 1e6);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(inviterAddress.address);
            expect(inviterAddressAfter).eq(inviterAddress.address);

            expect(inviter1Before.unclaimedBalance).eq(0);
            expect(inviter1Before.claimedBalance).eq(0);
            expect(inviter1Before.revShareFee).eq(0);
            expect(inviter1Before.level).eq(0);

            expect(inviter1After.unclaimedBalance).eq(0);
            expect(inviter1After.claimedBalance).eq(0);
            expect(inviter1After.revShareFee).eq(0);
            expect(inviter1After.level).eq(0);

            expect(originInviterBefore.unclaimedBalance).eq(10 * 1e6);
            expect(originInviterBefore.claimedBalance).eq(0);
            expect(originInviterBefore.revShareFee).eq(0);
            expect(originInviterBefore.level).eq(0);

            expect(originInviterAfter.unclaimedBalance).eq(20 * 1e6);
            expect(originInviterAfter.claimedBalance).eq(0);
            expect(originInviterAfter.revShareFee).eq(0);
            expect(originInviterAfter.level).eq(0);
          });

          it("claim is not ready", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Not finished yet");
          });

          it("claim", async () => {
            await aggregatorBTC.updateAnswer(21000 * 1e8);
            await time.increase(12 * 60 * 60);
            await usdt.transfer(vault.address, 100 * 1e6);

            const userBalanceBefore = await usdt.balanceOf(user.address);
            const vaultBalanceBefore = await usdt.balanceOf(vault.address);

            await dual.connect(user).claim(0, 2, 1);

            const userBalanceAfter = await usdt.balanceOf(user.address);
            const vaultBalanceAfter = await usdt.balanceOf(vault.address);
            const closedDual = await dual.get(0);

            expect(userBalanceBefore).eq(0);
            expect(userBalanceAfter).eq(20100 * 1e6);

            expect(vaultBalanceBefore).eq(40100 * 1e6);
            expect(vaultBalanceAfter).eq(20000 * 1e6);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(btc.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(usdt.address);
            expect(closedDual.inputAmount).eq(20000 * 1e6);
            expect(closedDual.inputBaseAmount).eq(0);
            expect(closedDual.inputQuoteAmount).eq(20000 * 1e6);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(20000 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(21000 * 1e6);
            expect(closedDual.outputToken).eq(usdt.address);
            expect(closedDual.outputAmount).eq(20100 * 1e6);
          });

          it("should not be double claimed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });
        });
        describe("non-referral", () => {});
      });
      describe("replayed", () => {
        describe("referral", () => {});
        describe("non-referral", () => {});
      });
    });
    describe("native", () => {
      describe("claimed", () => {
        describe("referral", () => {});
        describe("non-referral", () => {});
      });
      describe("replayed", () => {
        describe("referral", () => {});
        describe("non-referral", () => {});
      });
    });
  });

  describe("input = quote w/ down direction", () => {
    describe("token", () => {
      describe("claimed", () => {
        describe("referral", () => {
          let dual: DualFactory;
          let vault: Vault;
          let referral: Referral;
          let btc: Token;
          let usdt: Token;
          let user: SignerWithAddress;
          let inviterAddress: SignerWithAddress;
          let inviterAddress1: SignerWithAddress;
          let aggregatorBTC: MockV3Aggregator;

          before(async () => {
            ({dual, vault, referral, btc, usdt, user, inviterAddress, inviterAddress1, aggregatorBTC} =
              await loadFixture(deploy));

            await vault.updateThreshold(usdt.address, 20000 * 1e6);
          });

          it("create", async () => {
            await dual.addTariff({
              baseToken: btc.address,
              quoteToken: usdt.address,
              stakingPeriod: 12,
              yield: 0.005 * 1e8,
              enabled: true,
              id: 0,
            });

            await referral.updateRevShareFee(0.1 * 1e8);

            await usdt.transfer(user.address, 20000 * 1e6);
            await usdt.connect(user).approve(vault.address, 20000 * 1e6);

            const userBalanceBefore = await usdt.balanceOf(user.address);
            const vaultBalanceBefore = await usdt.balanceOf(vault.address);
            const inviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).create(0, user.address, usdt.address, 20000 * 1e6, inviterAddress.address);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await usdt.balanceOf(user.address);
            const vaultBalanceAfter = await usdt.balanceOf(vault.address);
            const inviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceBefore).eq(20000 * 1e6);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(0);
            expect(vaultBalanceAfter).eq(20000 * 1e6);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(usdt.address);
            expect(openedDual.inputAmount).eq(20000 * 1e6);
            expect(openedDual.inputBaseAmount).eq(0);
            expect(openedDual.inputQuoteAmount).eq(20000 * 1e6);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterBefore.unclaimedBalance).eq(0);
            expect(inviterBefore.claimedBalance).eq(0);
            expect(inviterBefore.revShareFee).eq(0);
            expect(inviterBefore.level).eq(0);

            expect(inviterAfter.unclaimedBalance).eq(10 * 1e6);
            expect(inviterAfter.claimedBalance).eq(0);
            expect(inviterAfter.revShareFee).eq(0);
            expect(inviterAfter.level).eq(0);
          });

          it("inviter can't be overriden", async () => {
            await usdt.transfer(user.address, 20000 * 1e6);
            await usdt.connect(user).approve(vault.address, 20000 * 1e6);

            const userBalanceBefore = await usdt.balanceOf(user.address);
            const vaultBalanceBefore = await usdt.balanceOf(vault.address);
            const inviterAddressBefore = await referral.users(user.address);
            const inviter1Before = await referral.inviters(inviterAddress1.address);
            const originInviterBefore = await referral.inviters(inviterAddress.address);

            await dual.connect(user).create(0, user.address, usdt.address, 20000 * 1e6, inviterAddress1.address);

            const openedDual = await dual.get(0);

            const userBalanceAfter = await usdt.balanceOf(user.address);
            const vaultBalanceAfter = await usdt.balanceOf(vault.address);
            const inviterAddressAfter = await referral.users(user.address);
            const inviter1After = await referral.inviters(inviterAddress1.address);
            const originInviterAfter = await referral.inviters(inviterAddress.address);

            expect(userBalanceBefore).eq(20000 * 1e6);
            expect(userBalanceAfter).eq(0);

            expect(vaultBalanceBefore).eq(20000 * 1e6);
            expect(vaultBalanceAfter).eq(40000 * 1e6);

            expect(openedDual.id).eq(0);
            expect(openedDual.user).eq(user.address);
            expect(openedDual.tariffId).eq(0);
            expect(openedDual.baseToken).eq(btc.address);
            expect(openedDual.quoteToken).eq(usdt.address);
            expect(openedDual.inputToken).eq(usdt.address);
            expect(openedDual.inputAmount).eq(20000 * 1e6);
            expect(openedDual.inputBaseAmount).eq(0);
            expect(openedDual.inputQuoteAmount).eq(20000 * 1e6);
            expect(openedDual.stakingPeriod).eq(12);
            expect(openedDual.yield).eq(0.005 * 1e8);
            expect(openedDual.initialPrice).eq(20000 * 1e6);
            expect(openedDual.claimed).eq(false);
            expect(openedDual.closedPrice).eq(0);
            expect(openedDual.outputToken).eq(ZERO_ADDRESS);
            expect(openedDual.outputAmount).eq(0);

            expect(inviterAddressBefore).eq(inviterAddress.address);
            expect(inviterAddressAfter).eq(inviterAddress.address);

            expect(inviter1Before.unclaimedBalance).eq(0);
            expect(inviter1Before.claimedBalance).eq(0);
            expect(inviter1Before.revShareFee).eq(0);
            expect(inviter1Before.level).eq(0);

            expect(inviter1After.unclaimedBalance).eq(0);
            expect(inviter1After.claimedBalance).eq(0);
            expect(inviter1After.revShareFee).eq(0);
            expect(inviter1After.level).eq(0);

            expect(originInviterBefore.unclaimedBalance).eq(10 * 1e6);
            expect(originInviterBefore.claimedBalance).eq(0);
            expect(originInviterBefore.revShareFee).eq(0);
            expect(originInviterBefore.level).eq(0);

            expect(originInviterAfter.unclaimedBalance).eq(20 * 1e6);
            expect(originInviterAfter.claimedBalance).eq(0);
            expect(originInviterAfter.revShareFee).eq(0);
            expect(originInviterAfter.level).eq(0);
          });

          it("claim is not ready", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Not finished yet");
          });

          it("claim", async () => {
            await aggregatorBTC.updateAnswer(19000 * 1e8);
            await time.increase(12 * 60 * 60);
            await btc.transfer(vault.address, e18.mul(1005).div(1000));

            const userBalanceBefore = await btc.balanceOf(user.address);
            const vaultBalanceBefore = await btc.balanceOf(vault.address);

            await dual.connect(user).claim(0, 2, 1);

            const userBalanceAfter = await btc.balanceOf(user.address);
            const vaultBalanceAfter = await btc.balanceOf(vault.address);
            const closedDual = await dual.get(0);

            expect(userBalanceBefore).eq(0);
            expect(userBalanceAfter).eq(e18.mul(1005).div(1000));

            expect(vaultBalanceBefore).eq(e18.mul(1005).div(1000));
            expect(vaultBalanceAfter).eq(0);

            expect(closedDual.id).eq(0);
            expect(closedDual.user).eq(user.address);
            expect(closedDual.tariffId).eq(0);
            expect(closedDual.baseToken).eq(btc.address);
            expect(closedDual.quoteToken).eq(usdt.address);
            expect(closedDual.inputToken).eq(usdt.address);
            expect(closedDual.inputAmount).eq(20000 * 1e6);
            expect(closedDual.inputBaseAmount).eq(0);
            expect(closedDual.inputQuoteAmount).eq(20000 * 1e6);
            expect(closedDual.stakingPeriod).eq(12);
            expect(closedDual.yield).eq(0.005 * 1e8);
            expect(closedDual.initialPrice).eq(20000 * 1e6);
            expect(closedDual.claimed).eq(true);
            expect(closedDual.closedPrice).eq(19000 * 1e6);
            expect(closedDual.outputToken).eq(btc.address);
            expect(closedDual.outputAmount).eq(e18.mul(1005).div(1000));
          });

          it("should not be double claimed", async () => {
            await expect(dual.connect(user).claim(0, 2, 1)).to.be.revertedWith("Dual: Already claimed");
          });
        });
        describe("non-referral", () => {});
      });
      describe("replayed", () => {
        describe("referral", () => {});
        describe("non-referral", () => {});
      });
    });
    describe("native", () => {
      describe("claimed", () => {
        describe("referral", () => {});
        describe("non-referral", () => {});
      });
      describe("replayed", () => {
        describe("referral", () => {});
        describe("non-referral", () => {});
      });
    });
  });

  describe("list & count", () => {
    let dual: DualFactory;
    let vault: Vault;
    let referral: Referral;
    let btc: Token;
    let usdt: Token;
    let user: SignerWithAddress;
    let inviterAddress: SignerWithAddress;
    let aggregatorBTC: MockV3Aggregator;

    before(async () => {
      ({dual, vault, referral, btc, usdt, user, inviterAddress, aggregatorBTC} = await loadFixture(deploy));

      await dual.addTariff({
        baseToken: btc.address,
        quoteToken: usdt.address,
        stakingPeriod: 12,
        yield: 0.005 * 1e8,
        enabled: true,
        id: 0,
      });

      await dual.addTariff({
        baseToken: btc.address,
        quoteToken: usdt.address,
        stakingPeriod: 24,
        yield: 0.005 * 1e8,
        enabled: true,
        id: 0,
      });

      await referral.updateRevShareFee(0.1 * 1e8);

      await vault.updateThreshold(usdt.address, 100000 * 1e6);
      await usdt.transfer(user.address, 60000 * 1e6);
      await usdt.connect(user).approve(vault.address, 60000 * 1e6);
      await aggregatorBTC.updateAnswer(21000 * 10 ** 8);

      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(0, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);

      await dual.connect(user).create(1, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(1, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(1, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(1, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(1, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(1, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(1, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(1, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(1, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);
      await dual.connect(user).create(1, user.address, usdt.address, 2000 * 1e6, inviterAddress.address);

      await time.increase(12 * 60 * 60 + 1);

      await dual.claim(0, 2, 1);
      await dual.claim(2, 2, 1);
      await dual.claim(4, 2, 1);
      await dual.claim(6, 2, 1);
      await dual.claim(8, 2, 1);
      await dual.claim(10, 2, 1);
      await dual.claim(12, 2, 1);
      await dual.claim(14, 2, 1);
      await dual.claim(16, 2, 1);
    });

    describe("all", () => {
      it("list id", async () => {
        const list = await dual.user(user.address);
        expect(list.length).eq(27);
      });
    });

    describe("opened", () => {
      it("count", async () => {
        expect(await dual.countUserOpenedDuals(user.address)).eq(10);
      });

      it("list limit=12 offset=0", async () => {
        const duals = await dual.userOpenedDuals(user.address, 12, 0);
        expect(duals.length).eq(10);
      });

      it("list limit=5 offset=0", async () => {
        const list = await dual.userOpenedDuals(user.address, 5, 0);

        expect(list[0].id).eq(26);
        expect(list[1].id).eq(25);
        expect(list[2].id).eq(24);
        expect(list[3].id).eq(23);
        expect(list[4].id).eq(22);
      });

      it("list limit=5 offset=5", async () => {
        const list = await dual.userOpenedDuals(user.address, 5, 5);

        expect(list[0].id).eq(21);
        expect(list[1].id).eq(20);
        expect(list[2].id).eq(19);
        expect(list[3].id).eq(18);
        expect(list[4].id).eq(17);
      });
    });

    describe("closed", () => {
      it("count", async () => {
        expect(await dual.countUserClosedDuals(user.address)).eq(8);
      });

      it("list limit=5 offset=0", async () => {
        const list = await dual.userClosedDuals(user.address, 5, 0);

        expect(list[0].id).eq(15);
        expect(list[1].id).eq(13);
        expect(list[2].id).eq(11);
        expect(list[3].id).eq(9);
        expect(list[4].id).eq(7);
      });

      it("list limit=5 offset=5", async () => {
        const list = await dual.userClosedDuals(user.address, 5, 5);

        expect(list[0].id).eq(5);
        expect(list[1].id).eq(3);
        expect(list[2].id).eq(1);
      });
    });

    describe("claimed", () => {
      it("count", async () => {
        expect(await dual.countUserClaimedDuals(user.address)).eq(9);
      });

      it("list limit=5 offset=0", async () => {
        const list = await dual.userClaimedDuals(user.address, 5, 0);

        expect(list[0].id).eq(16);
        expect(list[1].id).eq(14);
        expect(list[2].id).eq(12);
        expect(list[3].id).eq(10);
        expect(list[4].id).eq(8);
      });

      it("list limit=5 offset=5", async () => {
        const list = await dual.userClaimedDuals(user.address, 5, 5);

        expect(list[0].id).eq(6);
        expect(list[1].id).eq(4);
        expect(list[2].id).eq(2);
        expect(list[3].id).eq(0);
      });
    });
  });

  describe("addTariff()", () => {
    it("should add tariff", async () => {
      const {dual, btc, usdt} = await loadFixture(deploy);

      const tariffsBefore = await dual.tariffs();

      await dual.addTariff({
        id: 0,
        baseToken: btc.address,
        quoteToken: usdt.address,
        stakingPeriod: 12,
        yield: 0.005 * 1e8,
        enabled: true,
      });

      await dual.addTariff({
        id: 0,
        baseToken: btc.address,
        quoteToken: usdt.address,
        stakingPeriod: 24,
        yield: 0.01 * 1e8,
        enabled: true,
      });

      const tariffsAfter = await dual.tariffs();

      expect(tariffsBefore.length).to.be.equal(0);

      expect(tariffsAfter.length).to.be.equal(2);

      expect(tariffsAfter[0].id).to.be.equal(0);
      expect(tariffsAfter[0].baseToken).to.be.equal(btc.address);
      expect(tariffsAfter[0].quoteToken).to.be.equal(usdt.address);
      expect(tariffsAfter[0].stakingPeriod).to.be.equal(12);
      expect(tariffsAfter[0].yield).to.be.equal(0.005 * 1e8);
      expect(tariffsAfter[0].enabled).to.be.equal(true);

      expect(tariffsAfter[1].id).to.be.equal(1);
      expect(tariffsAfter[1].baseToken).to.be.equal(btc.address);
      expect(tariffsAfter[1].quoteToken).to.be.equal(usdt.address);
      expect(tariffsAfter[1].stakingPeriod).to.be.equal(24);
      expect(tariffsAfter[1].yield).to.be.equal(0.01 * 1e8);
      expect(tariffsAfter[1].enabled).to.be.equal(true);
    });

    it("should not add tariff if has no access", async () => {
      const {dual, user, btc, usdt} = await loadFixture(deploy);

      const tariffsBefore = await dual.tariffs();

      const tx = dual.connect(user).addTariff({
        id: 0,
        baseToken: btc.address,
        quoteToken: usdt.address,
        stakingPeriod: 12,
        yield: 0.005 * 1e8,
        enabled: true,
      });

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const tariffsAfter = await dual.tariffs();

      expect(tariffsBefore.length).to.be.equal(0);
      expect(tariffsAfter.length).to.be.equal(0);
    });
  });

  describe("enableTariff()", () => {
    it("should enable tariff", async () => {
      const {dual, btc, usdt} = await loadFixture(deploy);

      await dual.addTariff({
        id: 0,
        baseToken: btc.address,
        quoteToken: usdt.address,
        stakingPeriod: 12,
        yield: 0.005 * 1e8,
        enabled: false,
      });

      const tariffsBefore = await dual.tariffs();

      await dual.enableTariff(0);

      const tariffsAfter = await dual.tariffs();

      expect(tariffsBefore.length).to.be.equal(0);
      expect(tariffsAfter.length).to.be.equal(1);

      expect(tariffsAfter[0].id).to.be.equal(0);
      expect(tariffsAfter[0].baseToken).to.be.equal(btc.address);
      expect(tariffsAfter[0].quoteToken).to.be.equal(usdt.address);
      expect(tariffsAfter[0].stakingPeriod).to.be.equal(12);
      expect(tariffsAfter[0].yield).to.be.equal(0.005 * 1e8);
      expect(tariffsAfter[0].enabled).to.be.equal(true);
    });

    it("should not enable tariff if has no access", async () => {
      const {dual, user, btc, usdt} = await loadFixture(deploy);

      await dual.addTariff({
        id: 0,
        baseToken: btc.address,
        quoteToken: usdt.address,
        stakingPeriod: 12,
        yield: 0.005 * 1e8,
        enabled: false,
      });

      const tariffsBefore = await dual.tariffs();

      const tx = dual.connect(user).enableTariff(0);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const tariffsAfter = await dual.tariffs();

      expect(tariffsBefore.length).to.be.equal(0);
      expect(tariffsAfter.length).to.be.equal(0);
    });
  });

  describe("disableTariff()", () => {
    it("should disable tariff", async () => {
      const {dual, btc, usdt} = await loadFixture(deploy);

      await dual.addTariff({
        id: 0,
        baseToken: btc.address,
        quoteToken: usdt.address,
        stakingPeriod: 12,
        yield: 0.005 * 1e8,
        enabled: true,
      });

      await dual.addTariff({
        id: 0,
        baseToken: btc.address,
        quoteToken: usdt.address,
        stakingPeriod: 24,
        yield: 0.01 * 1e8,
        enabled: true,
      });

      const tariffsBefore = await dual.tariffs();

      await dual.disableTariff(0);

      const tariffsAfter = await dual.tariffs();

      expect(tariffsBefore.length).to.be.equal(2);

      expect(tariffsBefore[0].id).to.be.equal(0);
      expect(tariffsBefore[0].baseToken).to.be.equal(btc.address);
      expect(tariffsBefore[0].quoteToken).to.be.equal(usdt.address);
      expect(tariffsBefore[0].stakingPeriod).to.be.equal(12);
      expect(tariffsBefore[0].yield).to.be.equal(0.005 * 1e8);
      expect(tariffsBefore[0].enabled).to.be.equal(true);

      expect(tariffsBefore[1].id).to.be.equal(1);
      expect(tariffsBefore[1].baseToken).to.be.equal(btc.address);
      expect(tariffsBefore[1].quoteToken).to.be.equal(usdt.address);
      expect(tariffsBefore[1].stakingPeriod).to.be.equal(24);
      expect(tariffsBefore[1].yield).to.be.equal(0.01 * 1e8);
      expect(tariffsBefore[1].enabled).to.be.equal(true);

      expect(tariffsAfter.length).to.be.equal(1);
      expect(tariffsAfter[0].id).to.be.equal(1);
      expect(tariffsAfter[0].baseToken).to.be.equal(btc.address);
      expect(tariffsAfter[0].quoteToken).to.be.equal(usdt.address);
      expect(tariffsAfter[0].stakingPeriod).to.be.equal(24);
      expect(tariffsAfter[0].yield).to.be.equal(0.01 * 1e8);
      expect(tariffsAfter[0].enabled).to.be.equal(true);
    });

    it("should not disable tariff if has no access", async () => {
      const {dual, user, btc, usdt} = await loadFixture(deploy);

      await dual.addTariff({
        id: 0,
        baseToken: btc.address,
        quoteToken: usdt.address,
        stakingPeriod: 12,
        yield: 0.005 * 1e8,
        enabled: true,
      });

      const tariffsBefore = await dual.tariffs();

      const tx = dual.connect(user).disableTariff(0);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const tariffsAfter = await dual.tariffs();

      expect(tariffsAfter).to.be.deep.equal(tariffsBefore);
      expect(tariffsAfter.length).to.be.equal(1);

      expect(tariffsAfter[0].id).to.be.equal(0);
      expect(tariffsAfter[0].enabled).to.be.equal(true);
    });
  });

  describe("disable()", () => {
    it("should disable", async () => {
      const {dual} = await loadFixture(deploy);
      const enabledBefore = await dual.enabled();

      await dual.disable();

      const enabledAfter = await dual.enabled();

      expect(enabledBefore).to.be.equal(true);
      expect(enabledAfter).to.be.equal(false);
    });

    it("should not disable if has no access", async () => {
      const {dual, user} = await loadFixture(deploy);
      const enabledBefore = await dual.enabled();

      const tx = dual.connect(user).disable();

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const enabledAfter = await dual.enabled();

      expect(enabledBefore).to.be.equal(true);
      expect(enabledAfter).to.be.equal(true);
    });
  });

  describe("enable()", () => {
    it("should enable", async () => {
      const {dual} = await loadFixture(deploy);

      await dual.disable();

      const enabledBefore = await dual.enabled();

      await dual.enable();

      const enabledAfter = await dual.enabled();

      expect(enabledBefore).to.be.equal(false);
      expect(enabledAfter).to.be.equal(true);
    });

    it("should not enable if has no access", async () => {
      const {dual, user} = await loadFixture(deploy);

      await dual.disable();

      const enabledBefore = await dual.enabled();

      const tx = dual.connect(user).enable();

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const enabledAfter = await dual.enabled();

      expect(enabledBefore).to.be.equal(false);
      expect(enabledAfter).to.be.equal(false);
    });
  });

  describe("updateLimits()", () => {
    it("should update limits", async () => {
      const {dual, btc, usdt, weth} = await loadFixture(deploy);

      const limitsBefore = await dual.limits();

      await dual.updateLimits(btc.address, {
        minAmount: e18.div(10),
        maxAmount: e18.mul(10),
      });

      const limitsAfter = await dual.limits();

      expect(limitsBefore.length).to.be.equal(3);
      expect(limitsAfter.length).to.be.equal(3);

      expect(limitsBefore[0].token).to.be.equal(btc.address);
      expect(limitsBefore[0].minAmount).to.be.equal(e18.div(100));
      expect(limitsBefore[0].maxAmount).to.be.equal(e18.mul(5));

      expect(limitsBefore[1].token).to.be.equal(usdt.address);
      expect(limitsBefore[1].minAmount).to.be.equal(100 * 1e6);
      expect(limitsBefore[1].maxAmount).to.be.equal(50_000 * 1e6);

      expect(limitsBefore[2].token).to.be.equal(weth.address);
      expect(limitsBefore[2].minAmount).to.be.equal(e18.div(10));
      expect(limitsBefore[2].maxAmount).to.be.equal(e18.mul(50));

      expect(limitsAfter[0].token).to.be.equal(btc.address);
      expect(limitsAfter[0].minAmount).to.be.equal(e18.div(10));
      expect(limitsAfter[0].maxAmount).to.be.equal(e18.mul(10));

      expect(limitsAfter[1].token).to.be.equal(usdt.address);
      expect(limitsAfter[1].minAmount).to.be.equal(100 * 1e6);
      expect(limitsAfter[1].maxAmount).to.be.equal(50_000 * 1e6);

      expect(limitsAfter[2].token).to.be.equal(weth.address);
      expect(limitsAfter[2].minAmount).to.be.equal(e18.div(10));
      expect(limitsAfter[2].maxAmount).to.be.equal(e18.mul(50));
    });

    it("should not update limits if has no access", async () => {
      const {dual, user, btc} = await loadFixture(deploy);

      const limitsBefore = await dual.limits();

      const tx = dual.connect(user).updateLimits(btc.address, {
        minAmount: e18.div(10),
        maxAmount: e18.mul(10),
      });

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const limitsAfter = await dual.limits();

      expect(limitsAfter).to.be.deep.equal(limitsBefore);
      expect(limitsAfter.length).to.be.equal(3);
    });
  });

  describe("updateVault()", () => {
    it("should update vault", async () => {
      const {dual} = await loadFixture(deploy);
      const {address} = ethers.Wallet.createRandom();

      const vaultBefore = await dual.vault();

      await dual.updateVault(address);

      const vaultAfter = await dual.vault();

      expect(vaultAfter).not.to.be.equal(vaultBefore);
      expect(vaultAfter).to.be.equal(address);
    });

    it("should not update vault if has no access", async () => {
      const {dual, user} = await loadFixture(deploy);
      const {address} = ethers.Wallet.createRandom();

      const vaultBefore = await dual.vault();

      const tx = dual.connect(user).updateVault(address);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const vaultAfter = await dual.vault();

      expect(vaultAfter).to.be.equal(vaultBefore);
    });
  });

  describe("updatePriceFeed()", () => {
    it("should update price feed", async () => {
      const {dual} = await loadFixture(deploy);
      const {address} = ethers.Wallet.createRandom();

      const priceFeedBefore = await dual.priceFeed();

      await dual.updatePriceFeed(address);

      const priceFeedAfter = await dual.priceFeed();

      expect(priceFeedAfter).not.to.be.equal(priceFeedBefore);
      expect(priceFeedAfter).to.be.equal(address);
    });

    it("should not update price feed if has no access", async () => {
      const {dual, user} = await loadFixture(deploy);
      const {address} = ethers.Wallet.createRandom();

      const priceFeedBefore = await dual.priceFeed();

      const tx = dual.connect(user).updatePriceFeed(address);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const priceFeedAfter = await dual.priceFeed();

      expect(priceFeedAfter).to.be.equal(priceFeedBefore);
    });
  });

  describe("updateReferral()", () => {
    it("should update referral", async () => {
      const {dual} = await loadFixture(deploy);
      const {address} = ethers.Wallet.createRandom();

      const referralBefore = await dual.referral();

      await dual.updateReferral(address);

      const referralAfter = await dual.referral();

      expect(referralAfter).not.to.be.equal(referralBefore);
      expect(referralAfter).to.be.equal(address);
    });

    it("should not update referral if has no access", async () => {
      const {dual, user} = await loadFixture(deploy);
      const {address} = ethers.Wallet.createRandom();

      const referralBefore = await dual.referral();

      const tx = dual.connect(user).updateReferral(address);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const referralAfter = await dual.referral();

      expect(referralAfter).to.be.equal(referralBefore);
    });
  });
});
