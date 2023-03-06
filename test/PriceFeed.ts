import {expect} from "chai";
import {ethers} from "hardhat";
import {time, loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {MockV3Aggregator} from "../typechain-types";

const {BigNumber} = ethers;

const AGGREGATOR_DECIMALS = 8;
const e18 = BigNumber.from(10).pow(18);

describe("price feed", () => {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  const deploy = async () => {
    const [owner, user] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token");
    const btc = await Token.deploy("BTCB Token", "BTCB", 18);
    const usdt = await Token.deploy("Tether USD", "USDT", 6);
    const eth = await Token.deploy("Ethereum Token", "ETH", 18);
    const gmt = await Token.deploy("GMT", "GMT", 8);

    const V3Aggregator = await ethers.getContractFactory("MockV3Aggregator");

    const aggregatorBTC = await V3Aggregator.deploy(AGGREGATOR_DECIMALS, 0);
    const aggregatorETH = await V3Aggregator.deploy(18, 0);
    const aggregatorUSDT = await V3Aggregator.deploy(AGGREGATOR_DECIMALS, 0);
    const aggregatorGMT = await V3Aggregator.deploy(8, 0);

    const PriceFeed = await ethers.getContractFactory("PriceFeed");
    const priceFeed = await PriceFeed.deploy();

    return {
      priceFeed,

      btc,
      eth,
      usdt,
      gmt,

      owner,
      user,

      aggregatorBTC: aggregatorBTC as MockV3Aggregator,
      aggregatorETH: aggregatorETH as MockV3Aggregator,
      aggregatorUSDT: aggregatorUSDT as MockV3Aggregator,
      aggregatorGMT: aggregatorGMT as MockV3Aggregator,
    };
  };

  describe("constructor()", () => {
    it("should set the right access", async () => {
      const {priceFeed, owner, user} = await loadFixture(deploy);
      const role = await priceFeed.DEFAULT_ADMIN_ROLE();

      expect(await priceFeed.hasRole(role, owner.address)).to.equal(true);
      expect(await priceFeed.hasRole(role, user.address)).to.equal(false);
    });
  });

  describe("updateAggregator()", () => {
    it("should update aggregator", async () => {
      const {priceFeed, btc, eth, usdt, aggregatorBTC, aggregatorETH, aggregatorUSDT} = await loadFixture(deploy);

      const aggregatorsBefore = await priceFeed.aggregators();

      // specially double update to trigger 'if' condition
      await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);
      await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);

      await priceFeed.updateAggregator(eth.address, aggregatorETH.address);
      await priceFeed.updateAggregator(usdt.address, aggregatorUSDT.address);

      const aggregatorsAfter = await priceFeed.aggregators();

      expect(aggregatorsBefore.length).to.be.equal(0);
      expect(aggregatorsAfter.length).to.be.equal(3);

      expect(aggregatorsAfter[0].token).to.be.equal(btc.address);
      expect(aggregatorsAfter[0].aggregator).to.be.equal(aggregatorBTC.address);

      expect(aggregatorsAfter[1].token).to.be.equal(eth.address);
      expect(aggregatorsAfter[1].aggregator).to.be.equal(aggregatorETH.address);

      expect(aggregatorsAfter[2].token).to.be.equal(usdt.address);
      expect(aggregatorsAfter[2].aggregator).to.be.equal(aggregatorUSDT.address);
    });

    it("should not update aggregator if has no access", async () => {
      const {priceFeed, user, btc, aggregatorUSDT} = await loadFixture(deploy);

      // trying to update to invalid aggregator
      const tx = priceFeed.connect(user).updateAggregator(btc.address, aggregatorUSDT.address);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const aggregators = await priceFeed.aggregators();

      expect(aggregators.length).to.be.equal(0);
    });
  });

  describe("aggregator()", () => {
    it("should get aggregator", async () => {
      const {priceFeed, btc, usdt, aggregatorBTC} = await loadFixture(deploy);

      // specially double update to trigger 'if' condition
      await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);
      await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);

      const aggregator1 = await priceFeed.aggregator(btc.address);
      const aggregator2 = await priceFeed.aggregator(usdt.address);

      expect(aggregator1).to.be.equal(aggregatorBTC.address);
      expect(aggregator2).to.be.equal("0x0000000000000000000000000000000000000000");
    });
  });

  describe("decimals", () => {
    it("GMT/USDT 6", async () => {
      const {priceFeed, gmt, usdt, aggregatorGMT, aggregatorUSDT} = await loadFixture(deploy);

      await priceFeed.updateAggregator(gmt.address, aggregatorGMT.address);
      await priceFeed.updateAggregator(usdt.address, aggregatorUSDT.address);

      await aggregatorGMT.updateAnswer(0.49 * 1e8);
      await aggregatorUSDT.updateAnswer(1 * 1e8);

      const price = await priceFeed.currentCrossPrice(gmt.address, usdt.address);
      expect(price).eq(0.49 * 1e6);
    });

    it("GMT/BTC 18", async () => {
      const {priceFeed, gmt, btc, aggregatorGMT, aggregatorBTC} = await loadFixture(deploy);

      await priceFeed.updateAggregator(gmt.address, aggregatorGMT.address);
      await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);

      await aggregatorGMT.updateAnswer(0.49 * 1e8);
      await aggregatorBTC.updateAnswer(23000 * 1e8);

      const price = await priceFeed.currentCrossPrice(gmt.address, btc.address);
      expect(price).eq(0.000021304347826086 * 1e18);
    });

    it("ETH/GMT 8", async () => {
      const {priceFeed, gmt, eth, aggregatorGMT, aggregatorETH} = await loadFixture(deploy);

      await priceFeed.updateAggregator(eth.address, aggregatorETH.address);
      await priceFeed.updateAggregator(gmt.address, aggregatorGMT.address);

      await aggregatorETH.updateAnswer(e18.mul(1519));
      await aggregatorGMT.updateAnswer(0.49 * 1e8);

      const price = await priceFeed.currentCrossPrice(eth.address, gmt.address);
      expect(price).eq(3100 * 1e8);
    });

    it("ETH/USDT 6", async () => {
      const {priceFeed, usdt, eth, aggregatorUSDT, aggregatorETH} = await loadFixture(deploy);

      await priceFeed.updateAggregator(eth.address, aggregatorETH.address);
      await priceFeed.updateAggregator(usdt.address, aggregatorUSDT.address);

      await aggregatorETH.updateAnswer(e18.mul(1530));
      await aggregatorUSDT.updateAnswer(1 * 1e8);

      const price = await priceFeed.currentCrossPrice(eth.address, usdt.address);
      expect(price).eq(1530 * 1e6);
    });

    it("ETH/BTC 18", async () => {
      const {priceFeed, btc, eth, aggregatorBTC, aggregatorETH} = await loadFixture(deploy);

      await priceFeed.updateAggregator(eth.address, aggregatorETH.address);
      await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);

      await aggregatorETH.updateAnswer(e18.mul(1500));
      await aggregatorBTC.updateAnswer(25000 * 1e8);

      const price = await priceFeed.currentCrossPrice(eth.address, btc.address);
      expect(price).eq(e18.mul(6).div(100));
    });
  });

  describe("currentCrossPrice()", () => {
    it("should get current cross price", async () => {
      const {priceFeed, btc, usdt, aggregatorBTC, aggregatorUSDT} = await loadFixture(deploy);

      await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);
      await priceFeed.updateAggregator(usdt.address, aggregatorUSDT.address);

      await aggregatorBTC.updateAnswer(19500 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorUSDT.updateAnswer(1.01 * 10 ** AGGREGATOR_DECIMALS);

      const price = await priceFeed.currentCrossPrice(btc.address, usdt.address);

      // price's decimals is quote token's decimals
      expect(price).to.be.equal(Math.round(19306.930693069306 * 1e6));
    });

    it("should get current cross price after update", async () => {
      const {priceFeed, btc, usdt, aggregatorBTC, aggregatorUSDT} = await loadFixture(deploy);

      await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);
      await priceFeed.updateAggregator(usdt.address, aggregatorUSDT.address);

      await aggregatorBTC.updateAnswer(19500 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorUSDT.updateAnswer(1.01 * 10 ** AGGREGATOR_DECIMALS);

      await aggregatorBTC.updateAnswer(19600 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorUSDT.updateAnswer(1 * 10 ** AGGREGATOR_DECIMALS);

      const price = await priceFeed.currentCrossPrice(btc.address, usdt.address);

      // price's decimals is quote token's decimals
      expect(price).to.be.equal(Math.round(19600 * 1e6));
    });
  });

  describe("historicalCrossPrice()", () => {
    it("should get historical cross price 3/3", async () => {
      const {priceFeed, btc, usdt, aggregatorBTC, aggregatorUSDT} = await loadFixture(deploy);

      await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);
      await priceFeed.updateAggregator(usdt.address, aggregatorUSDT.address);

      await aggregatorBTC.updateAnswer(19500 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorBTC.updateAnswer(19600 * 10 ** AGGREGATOR_DECIMALS);

      await aggregatorUSDT.updateAnswer(1.01 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorUSDT.updateAnswer(1 * 10 ** AGGREGATOR_DECIMALS);

      const timestamp = (await time.latest()) + 10;

      await time.increase(100);

      const price = await priceFeed.historicalCrossPrice(btc.address, 3, usdt.address, 3, timestamp);

      // price's decimals is quote token's decimals
      expect(price).to.be.equal(Math.round(19600 * 1e6));
    });

    it("should get historical cross price 3/4", async () => {
      const {priceFeed, btc, usdt, aggregatorBTC, aggregatorUSDT} = await loadFixture(deploy);

      await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);
      await priceFeed.updateAggregator(usdt.address, aggregatorUSDT.address);

      await aggregatorBTC.updateAnswer(19500 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorBTC.updateAnswer(19600 * 10 ** AGGREGATOR_DECIMALS);

      await aggregatorUSDT.updateAnswer(1.01 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorUSDT.updateAnswer(1 * 10 ** AGGREGATOR_DECIMALS);

      const timestamp = (await time.latest()) + 10;

      await time.increase(100);

      await aggregatorBTC.updateAnswer(19700 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorUSDT.updateAnswer(1.02 * 10 ** AGGREGATOR_DECIMALS);

      const price = await priceFeed.historicalCrossPrice(btc.address, 3, usdt.address, 3, timestamp);

      // price's decimals is quote token's decimals
      expect(price).to.be.equal(Math.round(19600 * 1e6));
    });

    it("should not get historical cross price by time", async () => {
      const {priceFeed, btc, usdt, aggregatorBTC, aggregatorUSDT} = await loadFixture(deploy);

      await priceFeed.updateAggregator(btc.address, aggregatorBTC.address);
      await priceFeed.updateAggregator(usdt.address, aggregatorUSDT.address);

      await aggregatorBTC.updateAnswer(19500 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorBTC.updateAnswer(19600 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorBTC.updateAnswer(19700 * 10 ** AGGREGATOR_DECIMALS);

      await aggregatorUSDT.updateAnswer(1.01 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorUSDT.updateAnswer(1 * 10 ** AGGREGATOR_DECIMALS);
      await aggregatorUSDT.updateAnswer(1.02 * 10 ** AGGREGATOR_DECIMALS);

      const timestamp = (await time.latest()) + 10;

      await time.increase(100);

      await expect(priceFeed.historicalCrossPrice(btc.address, 3, usdt.address, 3, timestamp)).revertedWith(
        "PriceFeed: Out of range",
      );
    });
  });
});
