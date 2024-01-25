const hre = require('hardhat');
const { getChainId, ethers } = hre;
const { getContract } = require('../../utils.js');
const { deployContract } = require('./simple-deploy.js');

const SALT_INDEX = '';

module.exports = async ({ getNamedAccounts, deployments }) => {
    const PARAMS = {
        contractName: 'YOUR_CONTRACT_NAME',
        args: [],
        deploymentName: 'YOUR_DEPLOYMENT_NAME',
    };
    const SALT_PROD = ethers.keccak256(ethers.toUtf8Bytes(PARAMS.contractName + SALT_INDEX));

    console.log('running deploy script: use-create3/redeploy-oracle');
    console.log('network id ', await getChainId());

    const offchainOracle = await getContract(deployments, 'OffchainOracle');
    const oldCustomOracle = await getContract(deployments, PARAMS.contractName, PARAMS.deploymentName);
    const oracles = await offchainOracle.oracles();
    const customOracleType = oracles.oracleTypes[oracles.allOracles.indexOf(await oldCustomOracle.getAddress())];

    const customOracleAddress = await deployContract(PARAMS, SALT_PROD, deployments);

    await offchainOracle.removeOracle(oldCustomOracle, customOracleType);
    await offchainOracle.addOracle(customOracleAddress, customOracleType);
};

module.exports.skip = async () => true;
