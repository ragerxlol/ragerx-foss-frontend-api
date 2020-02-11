const path = require('path')
const webpack = require('webpack')
const nodeExternals = require('webpack-node-externals')

const serverConfig = {
  target: 'node',
  optimization: {
    minimize: true,
  },
  output: {
    libraryTarget: 'commonjs2',
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js'
  },
  externals: [ nodeExternals() ]
}

module.exports = [ serverConfig ]
