import {expect} from "chai";
import {ethers} from "hardhat";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {parseEther} from "ethers/lib/utils";

describe("vault", () => {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  const deploy = async () => {
    const [owner, user] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token");
    const token = await Token.deploy("Tether USD", "USDT", 6);

    const PayableContract = await ethers.getContractFactory("PayableContract");
    const payableContract = await PayableContract.deploy(user.address);

    const WETH = await ethers.getContractFactory("WETH");
    const weth = await WETH.deploy();

    const Vault = await ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(weth.address);

    return {vault, token, payableContract, weth, owner, user};
  };

  describe("constructor()", () => {
    it("should set the right access", async () => {
      const {vault, owner, user} = await loadFixture(deploy);
      const role = await vault.DEFAULT_ADMIN_ROLE();

      expect(await vault.hasRole(role, owner.address)).to.equal(true);
      expect(await vault.hasRole(role, user.address)).to.equal(false);
    });
  });

  describe("updateThreshold()", () => {
    it("should set threshold", async () => {
      const {vault, token, weth} = await loadFixture(deploy);

      await vault.updateThreshold(token.address, 100 * 1e6);
      await vault.updateThreshold(weth.address, 500 * 1e8);

      const ts = await vault.thresholds();

      expect(ts[0].token).eq(token.address);
      expect(ts[0].amount).eq(100 * 1e6);

      expect(ts[1].token).eq(weth.address);
      expect(ts[1].amount).eq(500 * 1e8);
    });

    it("should update threshold", async () => {
      const {vault, token, weth} = await loadFixture(deploy);

      await vault.updateThreshold(token.address, 100 * 1e6);
      await vault.updateThreshold(weth.address, 500 * 1e8);

      const ts1 = await vault.thresholds();

      await vault.updateThreshold(token.address, 1000 * 1e6);
      await vault.updateThreshold(weth.address, 5000 * 1e8);

      const ts2 = await vault.thresholds();

      expect(ts1[0].token).eq(token.address);
      expect(ts1[0].amount).eq(100 * 1e6);
      expect(ts1[1].token).eq(weth.address);
      expect(ts1[1].amount).eq(500 * 1e8);

      expect(ts2[0].token).eq(token.address);
      expect(ts2[0].amount).eq(1000 * 1e6);
      expect(ts2[1].token).eq(weth.address);
      expect(ts2[1].amount).eq(5000 * 1e8);
    });

    it("should not set threshold if has no access", async () => {
      const {vault, user, token} = await loadFixture(deploy);

      const thresholdsBefore = await vault.thresholds();
      const tx = vault.connect(user).updateThreshold(token.address, 100 * 1e6);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const thresholdsAfter = await vault.thresholds();

      expect(thresholdsBefore).to.be.deep.equal([]);
      expect(thresholdsAfter).to.be.deep.equal([]);
    });
  });

  describe("depositTokens()", () => {
    it("should deposit tokens", async () => {
      const {vault, user, token} = await loadFixture(deploy);

      await vault.updateThreshold(token.address, 100 * 1e6);

      // top up user to be sure here's enough funds to withdraw
      await token.transfer(user.address, 100 * 1e6);
      await token.connect(user).approve(vault.address, 100 * 1e6);

      const userBalanceBefore = await token.balanceOf(user.address);
      const vaultBalanceBefore = await token.balanceOf(vault.address);

      const tx = await vault.depositTokens(token.address, user.address, 50 * 1e6);
      const receipt = await tx.wait();

      const userBalanceAfter = await token.balanceOf(user.address);
      const vaultBalanceAfter = await token.balanceOf(vault.address);

      expect(vaultBalanceBefore).to.be.equal(0);
      expect(vaultBalanceAfter).to.be.equal(50 * 1e6);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(userBalanceAfter).to.be.equal(50 * 1e6);

      expect(receipt.events[0].address).to.be.equal(token.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Approval(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(50 * 1e6);

      expect(receipt.events[1].address).to.be.equal(token.address);
      expect(receipt.events[1].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[1].data, 16)).to.be.equal(50 * 1e6);
    });

    it("should send to bucket if amount > threshold", async () => {
      const {vault, user, token, owner} = await loadFixture(deploy);

      await vault.updateThreshold(token.address, 50 * 1e6);

      // top up user to be sure here's enough funds to withdraw
      await token.transfer(user.address, 100 * 1e6);
      await token.connect(user).approve(vault.address, 100 * 1e6);

      const userBalanceBefore = await token.balanceOf(user.address);
      const vaultBalanceBefore = await token.balanceOf(vault.address);
      const bucketBalanceBefore = await token.balanceOf(owner.address);

      await vault.depositTokens(token.address, user.address, 30 * 1e6);
      await vault.depositTokens(token.address, user.address, 70 * 1e6);

      const userBalanceAfter = await token.balanceOf(user.address);
      const vaultBalanceAfter = await token.balanceOf(vault.address);
      const bucketBalanceAfter = await token.balanceOf(owner.address);

      expect(vaultBalanceBefore).to.be.equal(0);
      expect(vaultBalanceAfter).to.be.equal(30 * 1e6);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(userBalanceAfter).to.be.equal(0);

      expect(bucketBalanceAfter).to.be.equal(bucketBalanceBefore.add(70 * 1e6));
    });

    it("should not deposit tokens if has no access", async () => {
      const {vault, user, token} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await token.transfer(user.address, 100 * 1e6);

      const userBalanceBefore = await token.balanceOf(user.address);
      const vaultBalanceBefore = await token.balanceOf(vault.address);

      const tx = vault.connect(user).depositTokens(token.address, user.address, 50 * 1e6);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const userBalanceAfter = await token.balanceOf(user.address);
      const vaultBalanceAfter = await token.balanceOf(vault.address);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceBefore).to.be.equal(0);

      expect(userBalanceAfter).to.be.equal(100 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(0);
    });

    it("should not deposit tokens if has not enough allowance", async () => {
      const {vault, user, token} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await token.transfer(user.address, 1000 * 1e6);
      await token.connect(user).approve(vault.address, 100 * 1e6);

      const userBalanceBefore = await token.balanceOf(user.address);
      const vaultBalanceBefore = await token.balanceOf(vault.address);

      const tx = vault.depositTokens(token.address, user.address, 1000 * 1e6);

      await expect(tx).to.be.revertedWith("ERC20: insufficient allowance");

      const userBalanceAfter = await token.balanceOf(user.address);
      const vaultBalanceAfter = await token.balanceOf(vault.address);

      expect(userBalanceBefore).to.be.equal(1000 * 1e6);
      expect(vaultBalanceBefore).to.be.equal(0);

      expect(userBalanceAfter).to.be.equal(1000 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(0);
    });

    it("should not deposit tokens if has no funds", async () => {
      const {vault, user, token} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to withdraw
      await token.transfer(user.address, 100 * 1e6);
      await token.connect(user).approve(vault.address, 1000 * 1e6);

      const userBalanceBefore = await token.balanceOf(user.address);
      const vaultBalanceBefore = await token.balanceOf(vault.address);

      const tx = vault.depositTokens(token.address, user.address, 1000 * 1e6);

      await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      const userBalanceAfter = await token.balanceOf(user.address);
      const vaultBalanceAfter = await token.balanceOf(vault.address);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceBefore).to.be.equal(0);

      expect(userBalanceAfter).to.be.equal(100 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(0);
    });

    it("should unwrap weth to eth", async () => {
      const {vault, user, weth} = await loadFixture(deploy);

      await vault.updateThreshold(weth.address, parseEther("1"));

      await weth.connect(user).deposit({value: parseEther("1")});
      await weth.connect(user).approve(vault.address, parseEther("1"));

      const userBalanceBefore = await weth.balanceOf(user.address);
      const vaultBalanceBefore = await weth.balanceOf(vault.address);
      const vaultETHBalanceBefore = await ethers.provider.getBalance(vault.address);

      const tx = await vault.depositTokens(weth.address, user.address, parseEther("1"));
      const receipt = await tx.wait();

      const userBalanceAfter = await weth.balanceOf(user.address);
      const vaultBalanceAfter = await weth.balanceOf(vault.address);
      const vaultETHBalanceAfter = await ethers.provider.getBalance(vault.address);

      expect(vaultETHBalanceBefore).to.be.equal(0);
      expect(vaultETHBalanceAfter).to.be.equal(parseEther("1"));

      expect(vaultBalanceBefore).to.be.equal(0);
      expect(vaultBalanceAfter).to.be.equal(0);

      expect(userBalanceBefore).to.be.equal(parseEther("1"));
      expect(userBalanceAfter).to.be.equal(0);

      expect(receipt.events[0].address).to.be.equal(weth.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        user.address,
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(1e18);

      expect(receipt.events[1].address).to.be.equal(weth.address);
      expect(receipt.events[1].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Withdrawal(address,uint256)")),
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(1e18);
    });

    it("should unwrap weth to eth w/ balancing to bucket", async () => {
      const {vault, user, owner, weth} = await loadFixture(deploy);

      await vault.updateThreshold(weth.address, parseEther("0.5"));

      await weth.connect(user).deposit({value: parseEther("1.5")});
      await weth.connect(user).approve(vault.address, parseEther("1.5"));

      const userBalanceBefore = await weth.balanceOf(user.address);
      const vaultBalanceBefore = await weth.balanceOf(vault.address);
      const vaultETHBalanceBefore = await ethers.provider.getBalance(vault.address);
      const bucketBalanceBefore = await weth.balanceOf(owner.address);
      const bucketETHBalanceBefore = await ethers.provider.getBalance(owner.address);

      const tx1 = await vault.depositTokens(weth.address, user.address, parseEther("0.5"));
      const tx2 = await vault.depositTokens(weth.address, user.address, parseEther("1"));

      const receipt1 = await tx1.wait();
      const receipt2 = await tx2.wait();

      let gasUsed = receipt1.gasUsed.mul(receipt1.effectiveGasPrice);

      gasUsed = gasUsed.add(receipt2.gasUsed.mul(receipt2.effectiveGasPrice));

      const userBalanceAfter = await weth.balanceOf(user.address);
      const vaultBalanceAfter = await weth.balanceOf(vault.address);
      const vaultETHBalanceAfter = await ethers.provider.getBalance(vault.address);
      const bucketBalanceAfter = await weth.balanceOf(owner.address);
      const bucketETHBalanceAfter = await ethers.provider.getBalance(owner.address);

      expect(userBalanceBefore).to.be.equal(parseEther("1.5"));
      expect(userBalanceAfter).to.be.equal(0);

      expect(vaultBalanceBefore).eq(0);
      expect(vaultBalanceAfter).eq(0);

      expect(vaultETHBalanceBefore).to.be.equal(0);
      expect(vaultETHBalanceAfter).to.be.equal(parseEther("0.5"));

      expect(bucketBalanceAfter).to.be.equal(bucketBalanceBefore);
      expect(bucketETHBalanceAfter).to.be.equal(bucketETHBalanceBefore.add(parseEther("1").sub(gasUsed)));
    });
  });

  describe("withdrawTokens()", () => {
    it("should withdraw tokens", async () => {
      const {vault, user, token} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await token.transfer(vault.address, 100 * 1e6);

      const userBalanceBefore = await token.balanceOf(user.address);
      const vaultBalanceBefore = await token.balanceOf(vault.address);

      const tx = await vault.withdrawTokens(token.address, user.address, 50 * 1e6);
      const receipt = await tx.wait();

      const userBalanceAfter = await token.balanceOf(user.address);
      const vaultBalanceAfter = await token.balanceOf(vault.address);

      expect(vaultBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(50 * 1e6);

      expect(userBalanceBefore).to.be.equal(0);
      expect(userBalanceAfter).to.be.equal(50 * 1e6);

      expect(receipt.events[0].address).to.be.equal(token.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        vault.address,
        user.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(50 * 1e6);
    });

    it("should not withdraw tokens if has no access", async () => {
      const {vault, user, token} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await token.transfer(vault.address, 100 * 1e6);

      const userBalanceBefore = await token.balanceOf(user.address);
      const vaultBalanceBefore = await token.balanceOf(vault.address);

      const tx = vault.connect(user).withdrawTokens(token.address, user.address, 50 * 1e6);

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const userBalanceAfter = await token.balanceOf(user.address);
      const vaultBalanceAfter = await token.balanceOf(vault.address);

      expect(userBalanceBefore).to.be.equal(0);
      expect(vaultBalanceBefore).to.be.equal(100 * 1e6);

      expect(userBalanceAfter).to.be.equal(0);
      expect(vaultBalanceAfter).to.be.equal(100 * 1e6);
    });

    it("should not withdraw tokens if has no funds", async () => {
      const {vault, user, token} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await token.transfer(vault.address, 100 * 1e6);

      const balanceBefore = await token.balanceOf(vault.address);

      const tx = vault.withdrawTokens(token.address, user.address, 1000 * 1e6);

      await expect(tx).to.be.revertedWith("ERC20: transfer amount exceeds balance");

      const balanceAfter = await token.balanceOf(vault.address);

      expect(balanceBefore).to.be.equal(100 * 1e6);
      expect(balanceAfter).to.be.equal(100 * 1e6);
    });

    it("should wrap eth to weth for withdrawal tokens", async () => {
      const {vault, user, owner, weth} = await loadFixture(deploy);

      await vault.updateThreshold(weth.address, parseEther("1"));

      await owner.sendTransaction({
        to: vault.address,
        value: parseEther("1"),
      });

      const userBalanceBefore = await weth.balanceOf(user.address);
      const vaultBalanceBefore = await weth.balanceOf(vault.address);
      const vaultETHBalanceBefore = await ethers.provider.getBalance(vault.address);

      const tx = await vault.withdrawTokens(weth.address, user.address, parseEther("1"));
      const receipt = await tx.wait();

      const userBalanceAfter = await weth.balanceOf(user.address);
      const vaultBalanceAfter = await weth.balanceOf(vault.address);
      const vaultETHBalanceAfter = await ethers.provider.getBalance(vault.address);

      expect(vaultETHBalanceBefore).to.be.equal(parseEther("1"));
      expect(vaultETHBalanceAfter).to.be.equal(0);

      expect(vaultBalanceBefore).to.be.equal(0);
      expect(vaultBalanceAfter).to.be.equal(0);

      expect(userBalanceBefore).to.be.equal(0);
      expect(userBalanceAfter).to.be.equal(parseEther("1"));

      expect(receipt.events[0].address).to.be.equal(weth.address);
      expect(receipt.events[0].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Deposit(address,uint256)")),
        vault.address,
      ]);
      expect(parseInt(receipt.events[0].data, 16)).to.be.equal(1e18);

      expect(receipt.events[1].address).to.be.equal(weth.address);
      expect(receipt.events[1].topics).to.be.deep.equal([
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("Transfer(address,address,uint256)")),
        vault.address,
        user.address,
      ]);
      expect(parseInt(receipt.events[1].data, 16)).to.be.equal(1e18);
    });
  });

  describe("deposit()", () => {
    it("should deposit", async () => {
      const {vault, weth} = await loadFixture(deploy);
      const balanceBefore = await ethers.provider.getBalance(vault.address);

      await vault.updateThreshold(weth.address, parseEther("1"));

      await vault.deposit({
        value: parseEther("1"),
      });

      const balanceAfter = await ethers.provider.getBalance(vault.address);

      expect(balanceBefore).to.be.equal(0);
      expect(balanceAfter).to.be.equal(parseEther("1"));
    });

    it("should send to bucket if amount > threshold", async () => {
      const {vault, weth, owner, user} = await loadFixture(deploy);

      await vault.updateThreshold(weth.address, parseEther("0.5"));

      const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);
      const bucketBalanceBefore = await ethers.provider.getBalance(owner.address);

      await vault.connect(user).deposit({
        value: parseEther("0.5"),
      });

      await vault.connect(user).deposit({
        value: parseEther("1"),
      });

      const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);
      const bucketBalanceAfter = await ethers.provider.getBalance(owner.address);

      expect(vaultBalanceBefore).to.be.equal(0);
      expect(vaultBalanceAfter).to.be.equal(parseEther("0.5"));

      expect(bucketBalanceAfter).to.be.equal(bucketBalanceBefore.add(parseEther("1")));
    });
  });

  describe("withdraw()", () => {
    it("should withdraw eth", async () => {
      const {vault, user, weth} = await loadFixture(deploy);

      await vault.updateThreshold(weth.address, parseEther("1"));

      // top up vault to be sure here's enough funds to withdraw
      await vault.deposit({
        value: parseEther("1"),
      });

      const userBalanceBefore = await ethers.provider.getBalance(user.address);
      const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);

      await vault.withdraw(user.address, parseEther("0.5"));

      const userBalanceAfter = await ethers.provider.getBalance(user.address);
      const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);

      expect(vaultBalanceBefore).to.be.equal(parseEther("1"));
      expect(vaultBalanceAfter).to.be.equal(parseEther("0.5"));

      expect(userBalanceAfter).to.be.equal(userBalanceBefore.add(parseEther("0.5")));
    });

    it("should withdraw eth to the contract with some logic on its side", async () => {
      const {vault, user, weth, payableContract} = await loadFixture(deploy);

      await vault.updateThreshold(weth.address, parseEther("1"));

      // top up vault to be sure here's enough funds to withdraw
      await vault.deposit({
        value: parseEther("1"),
      });

      const userBalanceBefore = await ethers.provider.getBalance(user.address);
      const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);

      await vault.withdraw(payableContract.address, parseEther("0.5"));

      const userBalanceAfter = await ethers.provider.getBalance(user.address);
      const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);

      expect(vaultBalanceBefore).to.be.equal(parseEther("1"));
      expect(vaultBalanceAfter).to.be.equal(parseEther("0.5"));

      expect(userBalanceAfter).to.be.equal(userBalanceBefore.add(parseEther("0.5")));
    });

    it("should not withdraw eth if has no access", async () => {
      const {vault, owner, user} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await vault.deposit({
        value: parseEther("1"),
      });

      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
      const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);

      const tx = vault.connect(user).withdraw(owner.address, parseEther("0.5"));

      await expect(tx).to.be.revertedWith(
        `AccessControl: account ${user.address.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`,
      );

      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);

      expect(ownerBalanceBefore).to.be.equal(ownerBalanceAfter);
      expect(vaultBalanceBefore).to.be.equal(vaultBalanceAfter);
    });

    it("should not withdraw eth if has no funds", async () => {
      const {vault, user} = await loadFixture(deploy);

      // top up vault to be sure here's enough funds to withdraw
      await vault.deposit({
        value: parseEther("1"),
      });

      const userBalanceBefore = await ethers.provider.getBalance(user.address);
      const vaultBalanceBefore = await ethers.provider.getBalance(vault.address);

      const tx = vault.withdraw(user.address, parseEther("10"));

      await expect(tx).to.be.revertedWith("Vault: Sending ETH has been failed");

      const userBalanceAfter = await ethers.provider.getBalance(user.address);
      const vaultBalanceAfter = await ethers.provider.getBalance(vault.address);

      expect(userBalanceBefore).to.be.equal(userBalanceAfter);
      expect(vaultBalanceBefore).to.be.equal(vaultBalanceAfter);
    });
  });

  describe("receive()", () => {
    it("should receive tokens", async () => {
      const {vault, user, owner, token} = await loadFixture(deploy);

      // top up user to be sure here's enough funds to transfer
      await token.transfer(user.address, 100 * 1e6);

      await vault.updateThreshold(token.address, parseEther("10"));

      const userBalanceBefore = await token.balanceOf(user.address);
      const vaultBalanceBefore = await token.balanceOf(vault.address);
      const bucketBalanceBefore = await token.balanceOf(owner.address);

      await user.sendTransaction({
        to: token.address,
        data: token.interface.encodeFunctionData("transfer", [vault.address, 60 * 1e6]),
        gasLimit: 1e5,
      });

      const userBalanceAfter = await token.balanceOf(user.address);
      const vaultBalanceAfter = await token.balanceOf(vault.address);
      const bucketBalanceAfter = await token.balanceOf(owner.address);

      expect(userBalanceBefore).to.be.equal(100 * 1e6);
      expect(vaultBalanceBefore).to.be.equal(0);

      expect(userBalanceAfter).to.be.equal(40 * 1e6);
      expect(vaultBalanceAfter).to.be.equal(60 * 1e6);

      expect(bucketBalanceAfter).to.be.equal(bucketBalanceBefore);
    });

    it("should receive eth", async () => {
      const {vault, user, owner, weth} = await loadFixture(deploy);

      await vault.updateThreshold(weth.address, parseEther("0.1"));

      const vaultETHBalanceBefore = await ethers.provider.getBalance(vault.address);
      const bucketETHBalanceBefore = await ethers.provider.getBalance(owner.address);

      await user.sendTransaction({
        to: vault.address,
        value: parseEther("1"),
        gasLimit: 1e5,
      });

      const vaultETHBalanceAfter = await ethers.provider.getBalance(vault.address);
      const bucketETHBalanceAfter = await ethers.provider.getBalance(owner.address);

      expect(vaultETHBalanceBefore).to.be.equal(0);
      expect(vaultETHBalanceAfter).to.be.equal(parseEther("1"));

      expect(bucketETHBalanceBefore).to.be.equal(bucketETHBalanceAfter);
    });
  });
});
