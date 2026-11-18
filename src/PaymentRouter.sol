// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "forge-std/interfaces/IERC20.sol";

/// @title PaymentRouter
/// @notice Minimal tUSD8 payment router for the QDay Catalog storefront.
///         Buyers pay fixed product prices in tUSD8; a spending-capped agent
///         address may also execute payments (agentic flows with least privilege).
contract PaymentRouter {
    struct Product {
        uint128 price;      // in token units (tUSD8 has 6 decimals)
        bool active;
        string name;
    }

    struct Agent {
        uint256 cap;        // total spending limit
        uint256 spent;      // cumulative amount spent by this agent
        bool authorized;
    }

    event ProductSet(uint256 indexed productId, uint128 price, bool active, string name);
    event Paid(
        uint256 indexed productId,
        address indexed payer,
        uint256 amount,
        bytes32 indexed txHash,
        uint64 paidAt
    );
    event AgentSet(address indexed agent, uint256 cap, bool authorized);
    event Withdrawn(address indexed to, uint256 amount);

    IERC20 public immutable token;      // tUSD8
    address public owner;
    uint256 public nextProductId = 1;

    mapping(uint256 => Product) public products;
    mapping(address => Agent) public agents;
    mapping(bytes32 => bool) public settledTx;   // replay protection per purchase context

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(IERC20 _token) {
        token = _token;
        owner = msg.sender;
    }

    function setProduct(uint256 productId, uint128 price, bool active, string calldata name)
        external
        onlyOwner
    {
        require(productId != 0, "id 0 reserved");
        products[productId] = Product(price, active, name);
        emit ProductSet(productId, price, active, name);
    }

    function setAgent(address agent, uint256 cap, bool authorized) external onlyOwner {
        require(agent != address(0), "zero agent");
        agents[agent] = Agent(cap, 0, authorized);
        emit AgentSet(agent, cap, authorized);
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero to");
        token.transfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Pay a product price with tUSD8 (requires prior approve on the router).
    ///         Anyone can pay; a registered agent pays within its cumulative cap.
    /// @param productId registered product id
    /// @param txHash    client-side hash of the purchase context (replay guard)
    function pay(uint256 productId, bytes32 txHash) external {
        Product memory p = products[productId];
        require(p.active, "inactive product");

        Agent storage a = agents[msg.sender];
        if (a.authorized) {
            require(a.spent + p.price <= a.cap, "agent cap exceeded");
            a.spent += p.price;
        }

        require(!settledTx[txHash], "tx already settled");
        token.transferFrom(msg.sender, address(this), p.price);
        settledTx[txHash] = true;

        emit Paid(productId, msg.sender, p.price, txHash, uint64(block.timestamp));
    }

    function priceOf(uint256 productId) external view returns (uint128) {
        return products[productId].price;
    }
}
