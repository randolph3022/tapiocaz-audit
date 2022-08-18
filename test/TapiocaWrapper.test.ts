import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { BytesLike } from 'ethers';
import { ethers } from 'hardhat';
import { generateSalt, useUtils } from '../scripts/utils';
import { TapiocaOFTMock__factory } from '../typechain';
import { setupFixture } from './fixtures';
import hre from 'hardhat';

describe('TapiocaWrapper', () => {
    describe('constructor()', () => {
        it('Should be owned by the deployer', async () => {
            const { signer, tapiocaWrapper } = await loadFixture(setupFixture);
            expect(await tapiocaWrapper.owner()).eq(signer.address);
        });
    });

    describe('createTOFT()', () => {
        it('Should fail if the ERC20 address is not the same as the registered TapiocaWrapper one', async () => {
            const { tapiocaWrapper } = await loadFixture(setupFixture);

            const erc20Address = ethers.Wallet.createRandom().address;
            const args: Parameters<TapiocaOFTMock__factory['deploy']> = [
                ethers.constants.AddressZero,
                erc20Address,
                'erc20name',
                'erc20symbol',
                2,
                0,
                0,
            ];
            const txData = (
                await ethers.getContractFactory('TapiocaOFTMock')
            ).getDeployTransaction(...args).data as BytesLike;

            await expect(
                tapiocaWrapper.createTOFT(
                    ethers.Wallet.createRandom().address,
                    txData,
                    generateSalt(),
                ),
            ).to.be.revertedWithCustomError(
                tapiocaWrapper,
                'TapiocaWrapper__FailedDeploy',
            );
        });

        it('Should create an OFT, add it to `tapiocaOFTs` array and `tapiocaOFTsByErc20` map', async () => {
            const { tapiocaWrapper } = await loadFixture(setupFixture);

            const erc20Address = ethers.Wallet.createRandom().address;
            const erc20Name = 'erc20name';

            const args: Parameters<TapiocaOFTMock__factory['deploy']> = [
                ethers.constants.AddressZero,
                erc20Address,
                erc20Name,
                'erc20symbol',
                2,
                0,
                0,
            ];
            const txData = (
                await ethers.getContractFactory('TapiocaOFTMock')
            ).getDeployTransaction(...args).data as BytesLike;

            const salt = generateSalt();
            await expect(
                await tapiocaWrapper.createTOFT(erc20Address, txData, salt),
            ).to.not.be.reverted;

            const tapiocaOFTArrayValue = await tapiocaWrapper.tapiocaOFTs(
                (await tapiocaWrapper.tapiocaOFTLength()).sub(1),
            );
            const tapiocaOFTMapValue = await tapiocaWrapper.tapiocaOFTsByErc20(
                erc20Address,
            );
            expect(tapiocaOFTArrayValue).to.not.equal(
                erc20Address,
                'tapiocaOFTs array should not be empty',
            );
            expect(tapiocaOFTMapValue).to.not.equal(
                erc20Address,
                'tapiocaOFTsByErc20 map should contains the new OFT address',
            );
            expect(tapiocaOFTArrayValue).to.eq(
                tapiocaOFTMapValue,
                'Map and array values should be equal',
            );

            const tapiocaOFT = await ethers.getContractAt(
                'TapiocaOFT',
                tapiocaOFTArrayValue,
            );

            expect(await tapiocaOFT.name()).to.eq(
                `TapiocaWrapper-${erc20Name}`,
            );
        });
    });

    describe('executeTOFT()', () => {});

    describe('tapiocaOFTLength()', () => {
        it('Should return the length of the `tapiocaOFTs` array', async () => {
            const { signer, erc20Mock, LZEndpointMock0 } = await loadFixture(
                setupFixture,
            );
            const { Tx_deployTapiocaOFT, deployTapiocaWrapper } = useUtils(hre);

            const tapiocaWrapper = await deployTapiocaWrapper();

            expect(await tapiocaWrapper.tapiocaOFTLength()).to.eq(0);

            const { txData: bytecode } = await Tx_deployTapiocaOFT(
                LZEndpointMock0.address,
                erc20Mock.address,
                0,
                signer,
            );
            await tapiocaWrapper.createTOFT(
                erc20Mock.address,
                bytecode,
                generateSalt(),
            );
            expect(await tapiocaWrapper.tapiocaOFTLength()).to.eq(1);
        });
    });

    describe('lastTOFT()', () => {
        it('Should fail if no TOFT has been created yet', async () => {
            const tapiocaWrapper = await (
                await (
                    await hre.ethers.getContractFactory('TapiocaWrapper')
                ).deploy()
            ).deployed();

            await expect(
                tapiocaWrapper.lastTOFT(),
            ).to.be.revertedWithCustomError(
                tapiocaWrapper,
                'TapiocaWrapper__NoTOFTDeployed',
            );
        });

        it('Should return the length of the last TOFT deployed', async () => {
            const {
                signer,
                tapiocaWrapper,
                erc20Mock,
                erc20Mock1,
                LZEndpointMock0,
                utils: { Tx_deployTapiocaOFT },
            } = await loadFixture(setupFixture);

            const erc20Address1 = erc20Mock.address;
            const erc20Address2 = erc20Mock1.address;

            const { txData: bytecode1 } = await Tx_deployTapiocaOFT(
                LZEndpointMock0.address,
                erc20Address1,
                0,
                signer,
                0,
            );
            const { txData: bytecode2 } = await Tx_deployTapiocaOFT(
                LZEndpointMock0.address,
                erc20Address2,
                0,
                signer,
                0,
            );

            await tapiocaWrapper.createTOFT(
                erc20Address1,
                bytecode1,
                generateSalt(),
            );

            const toft1 = await ethers.getContractAt(
                'TapiocaOFT',
                await tapiocaWrapper.lastTOFT(),
            );
            expect(await toft1.erc20()).to.eq(erc20Address1);

            await tapiocaWrapper.createTOFT(
                erc20Address2,
                bytecode2,
                generateSalt(),
            );

            const toft2 = await ethers.getContractAt(
                'TapiocaOFT',
                await tapiocaWrapper.lastTOFT(),
            );
            expect(await toft2.erc20()).to.eq(erc20Address2);
        });
    });
});
