// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PaymentRouter} from "../src/PaymentRouter.sol";

contract SetProducts is Script {
    // Top-selling Xynaptic services, prices mirrored from production x402
    // (micro-USDC 1:1 to tUSD8, 6 decimals).
    function run() external {
        address router = 0x883bC4F7a60aae4C51aF8cb57E43eb2ea6A1B263;
        PaymentRouter p = PaymentRouter(router);
        vm.startBroadcast();
        p.setProduct(1, 10000, true, "Xynaptic crypto-price - live crypto quotes (BTC/ETH/SOL/ADA)");
        p.setProduct(2, 10000, true, "Xynaptic news-us - US financial news feed");
        p.setProduct(3, 10000, true, "Xynaptic security-price - live stock quotes");
        p.setProduct(4, 30000, true, "Xynaptic intermodal-compare - multimodal route comparison");
        p.setProduct(5, 50000, true, "Xynaptic restaurant-nearby - restaurants near any FR address");
        vm.stopBroadcast();
        console2.log("5 products set on", router);
    }
}
