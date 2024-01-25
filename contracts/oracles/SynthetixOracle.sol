// SPDX-License-Identifier: MIT

pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/ISynthetixExchangeRates.sol";
import "../interfaces/ISynthetixProxy.sol";
import "../interfaces/ISynthetixAddressResolver.sol";
import "../interfaces/IOracle.sol";

contract SynthetixOracle is IOracle {
    error UnregisteredToken();
    error InvalidRate();

    ISynthetixProxy public immutable PROXY;
    IERC20 private constant _ETH = IERC20(0x0000000000000000000000000000000000000000);
    IERC20 private constant _NONE = IERC20(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF);
    uint256 private constant _RATE_TTL = 1 days;
    bytes32 private constant _EXCHANGE_RATES_KEY = 0x45786368616e6765526174657300000000000000000000000000000000000000;
    bytes32 private constant _SETH_KEY           = 0x50726f7879734554480000000000000000000000000000000000000000000000;
    bytes32 private constant _SNX_PROXY_KEY      = 0x50726f7879455243323000000000000000000000000000000000000000000000;
    bytes32 private constant _SUSD_PROXY_KEY     = 0x50726f7879455243323073555344000000000000000000000000000000000000;
    bytes32 private constant _PROXY_KEY          = 0x50726f7879000000000000000000000000000000000000000000000000000000;
    bytes private constant _SNX = "SNX";
    bytes private constant _SUSD = "sUSD";

    constructor(ISynthetixProxy _proxy) {
        PROXY = _proxy;
    }

    function getRate(IERC20 srcToken, IERC20 dstToken, IERC20 connector, uint256 /*thresholdFilter*/) external view override returns (uint256 rate, uint256 weight) {
        if(connector != _NONE) revert ConnectorShouldBeNone();
        ISynthetixAddressResolver resolver = ISynthetixAddressResolver(PROXY.target());
        ISynthetixExchangeRates exchangeRates = ISynthetixExchangeRates(resolver.getAddress(_EXCHANGE_RATES_KEY));

        uint256 srcAnswer = srcToken != _ETH ? _getRate(address(srcToken), resolver, exchangeRates) : _getRate(resolver.getAddress(_SETH_KEY), resolver, exchangeRates);
        uint256 dstAnswer = dstToken != _ETH ? _getRate(address(dstToken), resolver, exchangeRates) : _getRate(resolver.getAddress(_SETH_KEY), resolver, exchangeRates);
        rate = srcAnswer * 1e18 / dstAnswer;
        weight = 1e24;
    }

    function _getRate(address token, ISynthetixAddressResolver resolver, ISynthetixExchangeRates exchangeRates) private view returns(uint256) {
        string memory symbol = ERC20(token).symbol();

        bytes32 proxyKey;
        if (_memcmp(bytes(symbol), _SNX)) {
            proxyKey = _SNX_PROXY_KEY;
        } else if (_memcmp(bytes(symbol), _SUSD)) {
            proxyKey = _SUSD_PROXY_KEY;
        } else {
            assembly  ("memory-safe") { // solhint-disable-line no-inline-assembly
                proxyKey := or(_PROXY_KEY, shr(40, mload(add(symbol, 32))))
            }
        }
        if(resolver.getAddress(proxyKey) != token) revert UnregisteredToken();

        bytes32 key;
        assembly  ("memory-safe") { // solhint-disable-line no-inline-assembly
            key := mload(add(symbol, 32))
        }

        (uint256 answer, bool isInvalid) = exchangeRates.rateAndInvalid(key);
        if(isInvalid) revert InvalidRate();

        return answer;
    }

    function _memcmp(bytes memory a, bytes memory b) private pure returns(bool) {
        return (a.length == b.length) && (keccak256(a) == keccak256(b));
    }
}
