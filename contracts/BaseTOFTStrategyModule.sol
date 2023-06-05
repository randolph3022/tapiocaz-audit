// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

//LZ
import "tapioca-sdk/dist/contracts/libraries/LzLib.sol";

//TAPIOCA
import {IUSDOBase} from "tapioca-periph/contracts/interfaces/IUSDO.sol";
import "tapioca-periph/contracts/interfaces/ISwapper.sol";
import "tapioca-periph/contracts/interfaces/ITapiocaOFT.sol";

import "./BaseTOFTModule.sol";

contract BaseTOFTStrategyModule is BaseTOFTModule {
    using SafeERC20 for IERC20;
    using BytesLib for bytes;

    // ************ //
    // *** VARS *** //
    // ************ //
    uint16 constant PT_YB_SEND_STRAT = 770;
    uint16 constant PT_YB_RETRIEVE_STRAT = 771;

    constructor(
        address _lzEndpoint,
        address _erc20,
        IYieldBoxBase _yieldBox,
        string memory _name,
        string memory _symbol,
        uint8 _decimal,
        uint256 _hostChainID
    )
        BaseTOFTModule(
            _lzEndpoint,
            _erc20,
            _yieldBox,
            _name,
            _symbol,
            _decimal,
            _hostChainID
        )
    {
    }


    /// @notice sends TOFT to a specific strategy available on another layer
    /// @param _from the sender address
    /// @param _to the receiver address
    /// @param amount the transferred amount
    /// @param assetId the destination YieldBox asset id
    /// @param lzDstChainId the destination LayerZero id
    /// @param options the operation data
    function sendOrRetrieveStrategy(
        address _from,
        address _to,
        uint256 amount,
        uint256 share,
        uint256 assetId,
        uint16 lzDstChainId,
        ITapiocaOFT.ISendOptions calldata options,
        bytes memory airdropAdapterParam,
        bool retrieve
    ) external payable {
        require(amount > 0, "TOFT_0");
        bytes32 toAddress = LzLib.addressToBytes32(_to);
        _debitFrom(_from, lzEndpoint.getChainId(), toAddress, amount);

        bytes memory lzPayload = abi.encode(
            retrieve ? PT_YB_RETRIEVE_STRAT : PT_YB_SEND_STRAT,
            bytes32(uint(uint160(_from))),
            toAddress,
            amount,
            share,
            assetId,
            options.zroPaymentAddress
        );

        _lzSend(
            lzDstChainId,
            lzPayload,
            payable(_from),
            options.zroPaymentAddress,
            retrieve
                ? airdropAdapterParam
                : abi.encodePacked(uint16(1), options.extraGasLimit),
            msg.value
        );

        emit SendToChain(lzDstChainId, _from, toAddress, amount);
    }


    function strategyDeposit(
        uint16 _srcChainId,
        bytes memory _payload,
        IERC20 _erc20
    ) public {
        (
            ,
            ,
            bytes32 from,
            uint256 amount,
            uint256 share,
            uint256 assetId,

        ) = abi.decode(
                _payload,
                (uint16, bytes32, bytes32, uint256, uint256, uint256, address)
            );

        address onBehalfOf = address(uint160(uint(from)));

        _creditTo(_srcChainId, address(this), amount);
        _depositToYieldbox(
            assetId,
            amount,
            share,
            _erc20,
            address(this),
            onBehalfOf
        );

        emit ReceiveFromChain(_srcChainId, onBehalfOf, amount);
    }

    function strategyWithdraw(
        uint16 _srcChainId,
        bytes memory _payload
    ) public {
        (
            ,
            bytes32 from,
            ,
            uint256 _amount,
            uint256 _share,
            uint256 _assetId,
            address _zroPaymentAddress
        ) = abi.decode(
                _payload,
                (uint16, bytes32, bytes32, uint256, uint256, uint256, address)
            );

        address _from = LzLib.bytes32ToAddress(from);
        _retrieveFromYieldBox(_assetId, _amount, _share, _from, address(this));

        _debitFrom(
            address(this),
            lzEndpoint.getChainId(),
            LzLib.addressToBytes32(address(this)),
            _amount
        );

        bytes memory lzSendBackPayload = _encodeSendPayload(
            from,
            _ld2sd(_amount)
        );
        _lzSend(
            _srcChainId,
            lzSendBackPayload,
            payable(this),
            _zroPaymentAddress,
            "",
            address(this).balance
        );
        emit SendToChain(
            _srcChainId,
            _from,
            LzLib.addressToBytes32(address(this)),
            _amount
        );

        emit ReceiveFromChain(_srcChainId, _from, _amount);
    }

    /// @notice Receive an inter-chain transaction to execute a deposit inside YieldBox.
    function _depositToYieldbox(
        uint256 _assetId,
        uint256 _amount,
        uint256 _share,
        IERC20 _erc20,
        address _from,
        address _to
    ) private {
        _amount = _share > 0
            ? yieldBox.toAmount(_assetId, _share, false)
            : _amount;
        _erc20.approve(address(yieldBox), _amount);
        yieldBox.depositAsset(_assetId, _from, _to, _amount, _share);
    }

    /// @notice Receive an inter-chain transaction to execute a deposit inside YieldBox.
    function _retrieveFromYieldBox(
        uint256 _assetId,
        uint256 _amount,
        uint256 _share,
        address _from,
        address _to
    ) private {
        yieldBox.withdraw(_assetId, _from, _to, _amount, _share);
    }


    function _nonblockingLzReceive(
        uint16 _srcChainId,
        bytes memory,
        uint64,
        bytes memory _payload
    ) internal virtual override {
        uint256 packetType = _payload.toUint256(0);

        if (packetType == PT_YB_SEND_STRAT) {
            strategyDeposit(_srcChainId, _payload, IERC20(address(this)));
        } else if (packetType == PT_YB_RETRIEVE_STRAT) {
            strategyWithdraw(_srcChainId, _payload);
        } 
    }

}