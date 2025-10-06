import { ethers } from 'hardhat';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('Deploying BalancerFlashloanArbitrage contract...');

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log('Deploying with account:', deployer.address);
  console.log('Account balance:', (await deployer.provider.getBalance(deployer.address)).toString());

  // Deploy contract
  const BalancerFlashloanArbitrage = await ethers.getContractFactory('BalancerFlashloanArbitrage');
  const contract = await BalancerFlashloanArbitrage.deploy();
  
  await contract.waitForDeployment();
  
  const contractAddress = await contract.getAddress();
  console.log('BalancerFlashloanArbitrage deployed to:', contractAddress);
  
  // Verify ownership
  const owner = await contract.owner();
  console.log('Contract owner:', owner);
  
  console.log('\n✅ Deployment complete!');
  console.log('\nAdd this to your .env file:');
  console.log(`FLASHLOAN_CONTRACT_ADDRESS=${contractAddress}`);
  
  console.log('\nTo verify on PolygonScan, run:');
  console.log(`npx hardhat verify --network polygon ${contractAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
