import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import fetch from "isomorphic-fetch";
import dotenv from 'dotenv';
import JSBI from "jsbi";
import bs58 from 'bs58';
import {
    getPlatformFeeAccounts,
    Jupiter,
    RouteInfo,
    TOKEN_LIST_URL,
} from "@jup-ag/core";
import Decimal from "decimal.js";

let config = dotenv.config().parsed;

console.log('Arbritrager Started');
console.log('Config', config);


const ENV = 'mainnet-beta';
const USER_PRIVATE_KEY = bs58.decode(config!.WALLET_PRIVATE_KEY);
const USER_KEYPAIR = Keypair.fromSecretKey(USER_PRIVATE_KEY);


function unixTimestamp() {
    return Math.floor(Date.now() / 1000)
}

interface Token {
    chainId: number; // 101,
    address: string; // '8f9s1sUmzUbVZMoMh6bufMueYH1u4BJSM57RCEvuVmFp',
    symbol: string; // 'TRUE',
    name: string; // 'TrueSight',
    decimals: number; // 9,
    logoURI: string; // 'https://i.ibb.co/pKTWrwP/true.jpg',
    tags: string[]; // [ 'utility-token', 'capital-token' ]
}

const getPossiblePairsTokenInfo = ({
    tokens,
    routeMap,
    inputToken,
}: {
    tokens: Token[];
    routeMap: Map<string, string[]>;
    inputToken?: Token;
}) => {
    try {
        if (!inputToken) {
            return {};
        }

        const possiblePairs = inputToken
            ? routeMap.get(inputToken.address) || []
            : []; // return an array of token mints that can be swapped with SOL
        const possiblePairsTokenInfo: { [key: string]: Token | undefined } = {};
        possiblePairs.forEach((address) => {
            possiblePairsTokenInfo[address] = tokens.find((t) => {
                return t.address == address;
            });
        });
        // Perform your conditionals here to use other outputToken
        // const alternativeOutputToken = possiblePairsTokenInfo[USDT_MINT_ADDRESS]
        return possiblePairsTokenInfo;
    } catch (error) {
        throw error;
    }
};


const getRoutes = async ({
    jupiter,
    inputToken,
    outputToken,
    inputAmount,
    slippageBps,
}: {
    jupiter: Jupiter;
    inputToken?: Token;
    outputToken?: Token;
    inputAmount: number;
    slippageBps: number;
}) => {
    try {
        if (!inputToken || !outputToken) {
            return null;
        }

      //  console.log( `Getting routes for ${inputAmount} ${inputToken.symbol} -> ${outputToken.symbol}...`);
        const inputAmountInSmallestUnits = inputToken
            ? Math.round(inputAmount * 10 ** inputToken.decimals)
            : 0;

        const routes =
            inputToken && outputToken
                ? await jupiter.computeRoutes({
                        inputMint: new PublicKey(inputToken.address),
                        outputMint: new PublicKey(outputToken.address),
                        amount: JSBI.BigInt(inputAmountInSmallestUnits), // raw input amount of tokens
                        slippageBps,
                        forceFetch: true,
                    })
                : null;

        if (routes && routes.routesInfos)
        {
         //   console.log("Possible number of routes:", routes.routesInfos.length);
            console.log(
                "Best quote: ",
                new Decimal(routes.routesInfos[0].outAmount.toString())
                    .div(10 ** outputToken.decimals)
                    .toString(),
                `(${outputToken.symbol})`,
                routes.routesInfos.length
            );
            return routes.routesInfos[0];
        } else {
            return null;
        }
    } catch (error) {
        console.log( error);
    }
};

const executeSwap = async ({
    jupiter,
    routeInfo,
}: {
    jupiter: Jupiter;
    routeInfo: RouteInfo;
}) => {
    try {
        console.log('try to create tx', unixTimestamp());
        // Prepare execute exchange
        const { execute } = await jupiter.exchange({
            routeInfo,
        });

        console.log('tx ' + unixTimestamp() , execute);

        // Execute swap
        const swapResult: any = await execute(); // Force any to ignore TS misidentifying SwapResult type
        console.log('tx created', unixTimestamp());

        if (swapResult.error) {
            console.log('SWAP ERROR ' + unixTimestamp(), swapResult.error);
        } else {
            console.log(`https://explorer.solana.com/tx/${swapResult.txid}`);
            console.log(
                `inputAddress=${swapResult.inputAddress.toString()} outputAddress=${swapResult.outputAddress.toString()}`
            );
            console.log(
                `inputAmount=${swapResult.inputAmount} outputAmount=${swapResult.outputAmount}`
            );

        }
    } catch (error) {
        throw error;
    }
};

const main = async (config: any) => {

    try {
        const connection = new Connection(config.SOLANA_RPC_ENDPOINT); // Setup Solana RPC connection
        const tokens: Token[] = await (await fetch(TOKEN_LIST_URL[ENV])).json(); // Fetch token list from Jupiter API

        let platformFeeAndAccounts = {
                feeBps: 50,
                feeAccounts: await getPlatformFeeAccounts(
                    connection, new PublicKey("571AfEdTwMUFnGSv7dod4jYWAjTSVdf1JHmda5e7ieYF")
                )
            };

        const jupiter = await Jupiter.load({
            connection,
            cluster: ENV,
            user: USER_KEYPAIR,
          //  shouldLoadSerumOpenOrders: false,
        });
        console.log('Connected', unixTimestamp());
        const routeMap = jupiter.getRouteMap();

        const inputToken = tokens.find((t) =>  t.address == config.INPUT_TOKEN);
        const outputToken = tokens.find((t) => t.address == config.OUTPUT_TOKEN);
        const possiblePairsTokenInfo = await getPossiblePairsTokenInfo({
            tokens,
            routeMap,
            inputToken,
        });

       while (true)
       {
            const best = await getRoutes({
                jupiter,
                inputToken,
                outputToken,
                inputAmount: parseFloat(config.AMOUNT_TO_SWAP), // 1 unit in UI
                slippageBps: parseFloat(config.SLIPPAGE) * 100, // 1% slippage
            });
           let result = JSBI.LT(best?.inAmount, best?.otherAmountThreshold);
           if (result)
                await executeSwap({ jupiter, routeInfo: best! });

        }

    } catch (e)
    {
        console.log({ e });
    }
}

main(config);

