import { postgres } from './constants'
import logger from './logger'

import { promisify } from 'util'
import { Pool } from 'pg'
import Cursor from 'pg-cursor'

Cursor.prototype.readAsync = promisify(Cursor.prototype.read)

const pool = new Pool({
  host:     postgres.db_hostname,
  port:     postgres.db_port,
  database: postgres.db_name,
  user:     postgres.db_username,
  password: postgres.db_password,
})

export function init() {
  return new Promise((resolve, reject) => {
    pool.connect((error, client, done) => {
      if(error) {
        logger.log('error', 'database', error)
        return reject('Failed to connect to postgres')
      }
      done()
      logger.log('info', 'database', 'Connected to postgres on %s:%d', [postgres.db_hostname, postgres.db_port])
      resolve()
    })
  })
}

export { pool, Cursor }
