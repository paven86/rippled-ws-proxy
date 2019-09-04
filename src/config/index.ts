'use strict'

import fs from 'fs'
import path from 'path'
import Debug from 'debug'
const log = Debug('app')

// TODO: pm2 process exit restarts..? Kill in some kind of precheck

const get = () => {
  let config

  log('Getting...')

  try {
    config = fs.readFileSync(path.resolve(__dirname, '..', '..', 'config.json'))
    log('Got config from [ config.json ]')
  } catch (e) {
    log(`Config not found (config.json, (${e.message})), trying default config...`)
  }

  if (typeof config === 'undefined') {
    try {
      config = fs.readFileSync(path.resolve(__dirname, '..', '..', 'config.default.json'))
      log('Got config from [ config.default.json ]')
    } catch (e) {
      log('Cannot read default config either:', e.message)
      process.exit(1)
    }
  }

  try {
    config = JSON.parse(typeof config === 'undefined' ? '' : config.toString())
    if (typeof config.uplinks === 'undefined') {
      config.uplinks = [
        {
          type: 'fallback',
          endpoint: 'wss://s2.ripple.com/#fallback'
        }
      ]
    }
    config.uplinks.push({type: 'basic', endpoint: 'wss://s2.ripple.com/#basic', healthy: false})
    config.uplinks.push({type: 'priority', endpoint: 'wss://s2.ripple.com/#priority', healthy: false})
  } catch (e) {
    log('Cannot read JSON from config:', e.message)
    process.exit(1)
  }

  return config
}

export {
  get
}
