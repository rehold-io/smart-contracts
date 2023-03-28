/* eslint-disable import/no-extraneous-dependencies */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import {HardhatUserConfig} from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-etherscan";

dotenv.config();

const {NODE_ENV} = process.env;

if (NODE_ENV && fs.existsSync(path.resolve(`.env.${NODE_ENV}`))) {
  const variables = dotenv.parse(fs.readFileSync(path.resolve(`.env.${NODE_ENV}`)));

  for (const key in variables) {
    process.env[key] = variables[key];
  }
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        },
      },
      {
        version: "0.4.18",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        },
      },
    ],
  },
  etherscan: {
    apiKey: {
      bsc: process.env.BSCSCAN_API_KEY as string,
      polygon: process.env.POLYGONSCAN_API_KEY as string,
      avalanche: process.env.SNOWTRACE_API_KEY as string,
      opera: process.env.FTMSCAN_API_KEY as string,
    },
  },
  networks: {
    bsc: {
      url: "https://rpc.ankr.com/bsc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY as string] : undefined,
    },
    polygon: {
      url: "https://rpc.ankr.com/polygon",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY as string] : undefined,
    },
    avalanche: {
      url: "https://rpc.ankr.com/avalanche",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY as string] : undefined,
    },
    opera: {
      url: "https://rpc.ankr.com/fantom",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY as string] : undefined,
    },
  },
};

export default config;
