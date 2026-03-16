import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import testContractModule from "../ignition/modules/Lock";

describe("testContract", function (){
  async function testForChild() {
    const {testContract} = await loadFixture(testContractModule);
    return {testContract};
  }
})
