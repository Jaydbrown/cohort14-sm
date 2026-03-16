const { expect } = require("chai");
const { ethers } = require("hardhat");

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: There is a type mismatch in testContract.
//
//   mapping(address => mapping(uint256 => bool)) public isChild;
//
// The second key is uint256, but checkParentChild() passes `_child` (address)
// into that slot:
//
//   return isChild[father][_child] || isChild[mother][_child];
//
// Solidity silently casts address → uint160 → uint256, so the lookup compiles
// and runs, but it means you can NEVER set isChild[parent][child] via a
// normal call because the public getter/setter also uses uint256 as the key.
// The tests below cover the contract AS-IS and include a dedicated section
// that documents this behaviour.
// ─────────────────────────────────────────────────────────────────────────────

describe("testContract", function () {
  let contract: any;
  let deployer, father: any, mother: any, child1: any, child2: any, stranger: any;

  beforeEach(async function () {
    [deployer, father, mother, child1, child2, stranger] =
      await ethers.getSigners();

    const TestContract = await ethers.getContractFactory("testContract");
    contract = await TestContract.deploy();
    await contract.waitForDeployment();
  });

  // ── 1. Initial state ────────────────────────────────────────────────────────
  describe("Initial state", function () {
    it("should initialise father as the zero address", async function () {
      expect(await contract.father()).to.equal(ethers.ZeroAddress);
    });

    it("should initialise mother as the zero address", async function () {
      expect(await contract.mother()).to.equal(ethers.ZeroAddress);
    });

    it("checkParentChild should return false for any address before setup", async function () {
      expect(await contract.checkParentChild(child1.address)).to.equal(false);
      expect(await contract.checkParentChild(stranger.address)).to.equal(false);
    });
  });

  // ── 2. isChild mapping – direct storage interaction ─────────────────────────
  //
  // Because the contract has no setter functions we use hardhat's
  // `hardhat_setStorageAt` helper to write directly to the mapping slots so
  // we can exercise checkParentChild with known values.
  //
  // Storage layout:
  //   slot 0  → father  (address)
  //   slot 1  → mother  (address)
  //   slot 2  → isChild (mapping root)
  //
  // keccak256(abi.encode(outerKey, 2))          → outer slot
  // keccak256(abi.encode(innerKey, outerSlot))  → final bool slot
  //
  // The inner key is uint256, but Solidity casts the address to uint256 when
  // checkParentChild executes, so we must use the uint256 value of the address
  // as the inner key when pre-seeding storage.
  // ────────────────────────────────────────────────────────────────────────────

  function mapSlot(outerKey: any, outerKeyType: string, innerKey: any, innerKeyType: string, rootSlot: number) {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const outerSlot = ethers.keccak256(
      abiCoder.encode([outerKeyType, "uint256"], [outerKey, rootSlot])
    );
    const innerSlot = ethers.keccak256(
      abiCoder.encode([innerKeyType, "uint256"], [innerKey, outerSlot])
    );
    return innerSlot;
  }

  async function seedIsChild(parentAddress: any, childAddress: any, value: boolean) {
    const contractAddress = await contract.getAddress();
    // inner key must be uint256 (the address cast to uint256)
    const childAsUint = BigInt(childAddress);
    const slot = mapSlot(
      parentAddress,
      "address",
      childAsUint,
      "uint256",
      2 // mapping root slot
    );
    const encodedValue = value
      ? "0x" + "00".repeat(31) + "01"
      : "0x" + "00".repeat(32);
    await ethers.provider.send("hardhat_setStorageAt", [
      contractAddress,
      slot,
      encodedValue,
    ]);
  }

  async function seedAddress(slot: any, address: any) {
    const contractAddress = await contract.getAddress();
    const paddedAddress =
      "0x" + "00".repeat(12) + address.slice(2).toLowerCase();
    await ethers.provider.send("hardhat_setStorageAt", [
      contractAddress,
      "0x" + slot.toString(16),
      paddedAddress,
    ]);
  }

  // ── 3. checkParentChild via father ─────────────────────────────────────────
  describe("checkParentChild – father branch", function () {
    beforeEach(async function () {
      await seedAddress(0, father.address);   // set father
      await seedIsChild(father.address, child1.address, true);
    });

    it("returns true when isChild[father][child] is true", async function () {
      expect(await contract.checkParentChild(child1.address)).to.equal(true);
    });

    it("returns false for an address not recorded as a child of father", async function () {
      expect(await contract.checkParentChild(stranger.address)).to.equal(false);
    });

    it("returns false for child2 when only child1 is registered", async function () {
      expect(await contract.checkParentChild(child2.address)).to.equal(false);
    });
  });

  // ── 4. checkParentChild via mother ─────────────────────────────────────────
  describe("checkParentChild – mother branch", function () {
    beforeEach(async function () {
      await seedAddress(1, mother.address);   // set mother
      await seedIsChild(mother.address, child1.address, true);
    });

    it("returns true when isChild[mother][child] is true", async function () {
      expect(await contract.checkParentChild(child1.address)).to.equal(true);
    });

    it("returns false for a stranger even when mother is set", async function () {
      expect(await contract.checkParentChild(stranger.address)).to.equal(false);
    });
  });

  // ── 5. OR logic – child registered to only one parent ──────────────────────
  describe("OR logic between father and mother", function () {
    beforeEach(async function () {
      await seedAddress(0, father.address);
      await seedAddress(1, mother.address);
    });

    it("returns true when registered under father but not mother", async function () {
      await seedIsChild(father.address, child1.address, true);
      expect(await contract.checkParentChild(child1.address)).to.equal(true);
    });

    it("returns true when registered under mother but not father", async function () {
      await seedIsChild(mother.address, child1.address, true);
      expect(await contract.checkParentChild(child1.address)).to.equal(true);
    });

    it("returns true when registered under both parents", async function () {
      await seedIsChild(father.address, child1.address, true);
      await seedIsChild(mother.address, child1.address, true);
      expect(await contract.checkParentChild(child1.address)).to.equal(true);
    });

    it("returns false when registered under neither parent", async function () {
      await seedIsChild(father.address, child1.address, true);
      await seedIsChild(mother.address, child1.address, true);
      // stranger has no entry
      expect(await contract.checkParentChild(stranger.address)).to.equal(false);
    });
  });

  // ── 6. Multiple children ────────────────────────────────────────────────────
  describe("multiple children", function () {
    beforeEach(async function () {
      await seedAddress(0, father.address);
      await seedAddress(1, mother.address);
      await seedIsChild(father.address, child1.address, true);
      await seedIsChild(mother.address, child2.address, true);
    });

    it("each child is recognised independently", async function () {
      expect(await contract.checkParentChild(child1.address)).to.equal(true);
      expect(await contract.checkParentChild(child2.address)).to.equal(true);
    });

    it("a stranger is still not recognised", async function () {
      expect(await contract.checkParentChild(stranger.address)).to.equal(false);
    });
  });

  // ── 7. Resetting a child entry to false ────────────────────────────────────
  describe("revoking child status", function () {
    it("returns false after a true entry is reset to false", async function () {
      await seedAddress(0, father.address);
      await seedIsChild(father.address, child1.address, true);
      expect(await contract.checkParentChild(child1.address)).to.equal(true);

      await seedIsChild(father.address, child1.address, false);
      expect(await contract.checkParentChild(child1.address)).to.equal(false);
    });
  });

  // ── 8. Zero-address parents (default state) ────────────────────────────────
  describe("zero-address parent edge case", function () {
    it("checkParentChild with zero-address parents never throws", async function () {
      // Both parents are 0x0; the mapping lookup simply returns false
      await expect(contract.checkParentChild(child1.address)).to.not.be
        .reverted;
    });

    it("isChild[0x0][child] is false by default", async function () {
      const result = await contract.isChild(ethers.ZeroAddress, BigInt(child1.address));
      expect(result).to.equal(false);
    });
  });

  // ── 9. Type-mismatch documentation ────────────────────────────────────────
  //
  // This section exists purely to document (and assert) the address→uint256
  // implicit cast behaviour. It is NOT a passing design test – it shows the
  // BUG so you know to fix it.
  //
  // The mapping key is uint256, but checkParentChild passes an address.
  // Solidity treats this as: uint256(uint160(address)).
  // Reading the mapping with the public getter therefore requires passing
  // the numeric value of the address, not the address type.
  // ────────────────────────────────────────────────────────────────────────────
  describe("BUG: uint256 inner key vs address argument in checkParentChild", function () {
    it("isChild public getter requires uint256 key, not address", async function () {
      await seedAddress(0, father.address);
      await seedIsChild(father.address, child1.address, true);

      // Correct: pass BigInt(address) – the uint256 form
      const viaUint = await contract.isChild(
        father.address,
        BigInt(child1.address)
      );
      expect(viaUint).to.equal(true);

      // The above confirms the mapping CAN be read correctly via BigInt.
      // checkParentChild() also works because Solidity casts internally.
      expect(await contract.checkParentChild(child1.address)).to.equal(true);
    });
  });
});