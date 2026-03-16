pragma solidity ^0.8.28;

contract testContract {
    address public father;
    address public mother;

    mapping(address => mapping(uint256 => bool)) public isChild;

    function checkParentChild(address _child) public view returns (bool) {
        return isChild[father][_child] || isChild[mother][_child];
    }
}