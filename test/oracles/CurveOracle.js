const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');
const { ethers } = require('hardhat');
const { expect, assertRoughlyEqualValues, deployContract } = require('@1inch/solidity-utils');
const {
    tokens,
    deployParams: { AaveWrapperV2, Curve, Uniswap, UniswapV2, UniswapV3 },
    defaultValues: { thresholdFilter },
} = require('../helpers.js');

describe('CurveOracle', function () {
    async function initContracts () {
        const curveOracle = await deployContract('CurveOracle', [Curve.provider, Curve.maxPools, Curve.registryIds, Curve.registryTypes]);
        const uniswapV3Oracle = await deployContract('UniswapV3LikeOracle', [UniswapV3.factory, UniswapV3.initcodeHash, UniswapV3.fees]);
        return { curveOracle, uniswapV3Oracle };
    }

    it('usdt -> wbtc', async function () {
        const { curveOracle, uniswapV3Oracle } = await loadFixture(initContracts);
        const expectedRate = await uniswapV3Oracle.getRate(tokens.USDT, tokens.WBTC, tokens.NONE, thresholdFilter);
        const rate = await curveOracle.getRate(tokens.USDT, tokens.WBTC, tokens.NONE, thresholdFilter);
        assertRoughlyEqualValues(rate.rate.toString(), expectedRate.rate.toString(), '0.05');
    });

    it('wbtc -> usdc', async function () {
        const { curveOracle, uniswapV3Oracle } = await loadFixture(initContracts);
        const expectedRate = await uniswapV3Oracle.getRate(tokens.WBTC, tokens.USDT, tokens.NONE, thresholdFilter);
        const rate = await curveOracle.getRate(tokens.WBTC, tokens.USDT, tokens.NONE, thresholdFilter);
        assertRoughlyEqualValues(rate.rate.toString(), expectedRate.rate.toString(), '0.05');
    });

    it('wbtc -> weth', async function () {
        const { curveOracle, uniswapV3Oracle } = await loadFixture(initContracts);
        const expectedRate = await uniswapV3Oracle.getRate(tokens.WBTC, tokens.WETH, tokens.NONE, thresholdFilter);
        const rate = await curveOracle.getRate(tokens.WBTC, tokens.WETH, tokens.NONE, thresholdFilter);
        assertRoughlyEqualValues(rate.rate.toString(), expectedRate.rate.toString(), '0.05');
    });

    it('should use correct `get_dy` selector when vyper return redundant bytes', async function () {
        const { curveOracle } = await loadFixture(initContracts);
        const rate = await curveOracle.getRate(tokens.BEAN, tokens['3CRV'], tokens.NONE, thresholdFilter);
        expect(rate.rate).to.gt('0');
    });

    describe('doesn\'t ruin various registry with different selectors', function () {
        it('Main Registry', async function () {
            await testNotRuins(0, 2n);
        });

        it('Metapool Factory', async function () {
            await testNotRuins(1, 2n);
        });

        it('Cryptoswap Registry', async function () {
            await testNotRuins(2, 2n);
        });

        it('Cryptopool Factory', async function () {
            await testNotRuins(3, 2n);
        });

        it('Metaregistry', async function () {
            await testNotRuins(4, 2n);
        });

        it('crvUSD Plain Pools', async function () {
            await testNotRuins(5, 2n);
        });

        it('Curve Tricrypto Factory', async function () {
            await testNotRuins(6, 2n);
        });

        async function testNotRuins (registryIndex, testPoolsAmount) {
            const poolAbiUint256 = [
                {
                    name: 'coins',
                    type: 'function',
                    inputs: [{ type: 'uint256', name: 'arg0' }],
                    outputs: [{ type: 'address', name: 'value' }],
                    stateMutability: 'view',
                },
            ];
            const poolAbiInt128 = [
                {
                    name: 'coins',
                    type: 'function',
                    inputs: [{ type: 'int128', name: 'arg0' }],
                    outputs: [{ type: 'address', name: 'value' }],
                    stateMutability: 'view',
                },
            ];

            const curveOracle = await deployContract('CurveOracle', [Curve.provider, Curve.maxPools, [Curve.registryIds[registryIndex]], [Curve.registryTypes[registryIndex]]]);
            const curveProvider = await ethers.getContractAt('ICurveProvider', Curve.provider);
            const registryAddress = await curveProvider.get_address(Curve.registryIds[registryIndex]);
            const registry = await ethers.getContractAt('ICurveRegistry', registryAddress);

            const poolCount = await registry.pool_count();

            // we check only `testPoolsAmount` random pools from the registry to save time
            for (let i = 0n; i < poolCount; i += (poolCount / testPoolsAmount)) {
                const poolAddress = await registry.pool_list(i);
                let token0, token1;
                try {
                    const poolUint256 = await ethers.getContractAt(poolAbiUint256, poolAddress);
                    token0 = await poolUint256.coins(0);
                    token1 = await poolUint256.coins(1);
                } catch (e) {
                    try {
                        const poolInt128 = await ethers.getContractAt(poolAbiInt128, poolAddress);
                        token0 = await poolInt128.coins(0);
                        token1 = await poolInt128.coins(1);
                    } catch (e) {
                        expect.fail(`pool ${i} ${poolAddress} doesn't work with uint256 and int128 selectors of \`coins\` method`);
                    }
                }
                await curveOracle.getRate(token0, token1, tokens.NONE, thresholdFilter);
            }
        }
    });
});

describe('CurveOracle doesn\'t ruin rates', function () {
    async function initContracts () {
        const [deployer] = await ethers.getSigners();

        const uniswapV2LikeOracle = await deployContract('UniswapV2LikeOracle', [UniswapV2.factory, UniswapV2.initcodeHash]);
        const curveOracle = await deployContract('CurveOracle', [Curve.provider, Curve.maxPools, Curve.registryIds, Curve.registryTypes]);
        const uniswapOracle = await deployContract('UniswapOracle', [Uniswap.factory]);
        const mooniswapOracle = await deployContract('MooniswapOracle', [tokens.oneInchLP1]);
        const wethWrapper = await deployContract('BaseCoinWrapper', [tokens.ETH, tokens.WETH]);
        const aaveWrapperV1 = await deployContract('AaveWrapperV1');
        const aaveWrapperV2 = await deployContract('AaveWrapperV2', [AaveWrapperV2.lendingPool]);
        await aaveWrapperV1.addMarkets([tokens.DAI]);
        await aaveWrapperV2.addMarkets([tokens.DAI]);
        const multiWrapper = await deployContract('MultiWrapper', [
            [
                wethWrapper,
                aaveWrapperV1,
                aaveWrapperV2,
            ],
            deployer,
        ]);

        const oldOffchainOracle = await deployContract('OffchainOracle', [
            multiWrapper,
            [
                uniswapV2LikeOracle,
                uniswapOracle,
                mooniswapOracle,
            ],
            [
                '0',
                '1',
                '2',
            ],
            [
                tokens.NONE,
                tokens.ETH,
                tokens.WETH,
                tokens.USDC,
                tokens.DAI,
            ],
            tokens.WETH,
            deployer.address,
        ]);

        const newOffchainOracle = await deployContract('OffchainOracle', [
            multiWrapper,
            [
                uniswapV2LikeOracle,
                uniswapOracle,
                mooniswapOracle,
                curveOracle,
            ],
            [
                '0',
                '1',
                '2',
                '2',
            ],
            [
                tokens.NONE,
                tokens.ETH,
                tokens.USDC,
                tokens.DAI,
            ],
            tokens.WETH,
            deployer.address,
        ]);

        return { oldOffchainOracle, newOffchainOracle };
    }

    it('WBTC WETH', async function () {
        const { oldOffchainOracle, newOffchainOracle } = await loadFixture(initContracts);
        await testRate(tokens.WBTC, tokens.WETH, oldOffchainOracle, newOffchainOracle);
    });

    it('WBTC USDT', async function () {
        const { oldOffchainOracle, newOffchainOracle } = await loadFixture(initContracts);
        await testRate(tokens.WBTC, tokens.USDT, oldOffchainOracle, newOffchainOracle);
    });

    async function testRate (srcToken, dstToken, oldOffchainOracle, newOffchainOracle) {
        const expectedRate = await oldOffchainOracle.getRateWithThreshold(srcToken, dstToken, true, thresholdFilter);
        const actualRate = await newOffchainOracle.getRateWithThreshold(srcToken, dstToken, true, thresholdFilter);
        const expectedReverseRate = await oldOffchainOracle.getRateWithThreshold(dstToken, srcToken, true, thresholdFilter);
        const actualReverseRate = await newOffchainOracle.getRateWithThreshold(dstToken, srcToken, true, thresholdFilter);
        assertRoughlyEqualValues(actualRate, expectedRate, '0.05');
        assertRoughlyEqualValues(actualReverseRate, expectedReverseRate, '0.05');
    }
});
