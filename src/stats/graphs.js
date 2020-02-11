import { coin } from '../constants'

import * as time from '../time'
import { pool } from '../database'
import logger from '../logger'
import { format } from 'util'

const query_get_blocks_per_hour = {
  name: 'get-blocks-per-hour',
  text: `
  SELECT
  COUNT(*) AS count,
  CAST(EXTRACT(epoch FROM DATE_TRUNC('hour', TO_TIMESTAMP(time + 1262304000))) AS INTEGER) AS time
  FROM
  mined_blocks
  WHERE status > 0 AND TO_TIMESTAMP(time + 1262304000) >= (CURRENT_DATE - INTERVAL '31 days')
  GROUP BY time
  ORDER BY time ASC
  `
}

export function getBlocksPerHour() {
  return pool.query(query_get_blocks_per_hour).then(res => {
    return res.rows
  }).catch(error => {
    logger.log('error', 'graphs', 'Failed to get blocks per hour')
    logger.log('error', 'graphs', error)
    return []
  })
}

const query_generate_hashrate_min_max = `
SELECT
MIN(time) AS min,
MAX(time) AS max
FROM valid_shares
WHERE time > COALESCE((SELECT MAX(tsample) FROM %s), 0)
`

const query_generate_hashrate_min_max_5m = {
  name: 'generate-hashrate-min-max-5m',
  text: format(query_generate_hashrate_min_max, 'hashrate_5min')
}

const query_generate_hashrate_min_max_1hr = {
  name: 'generate-hashrate-min-max-1hr',
  text: format(query_generate_hashrate_min_max, 'hashrate_1hr')
}

const query_generate_hashrate_user_insert = `
INSERT INTO %s
  SELECT
  uid,
  rid,
  SUM(CASE WHEN row_number = 1 THEN 0 ELSE count END),
  t,
  MIN(time),
  MAX(time)
  FROM generate_series(($1)::INT, ($2)::INT, ($3)::INT) AS t
  LEFT JOIN LATERAL (
    SELECT
    uid,
    rid,
    count,
    time,
    ROW_NUMBER() OVER(PARTITION BY uid, rid ORDER BY time ASC) AS row_number
    FROM
    valid_shares
    WHERE time BETWEEN (t - $4) AND t
    ORDER BY time ASC
  ) shares ON time BETWEEN (t - $4) AND t
  WHERE rid IS NOT NULL
  GROUP BY uid, rid, t
  ORDER BY t ASC
ON CONFLICT DO NOTHING
`
const query_generate_hashrate_user_insert_5m = {
  name: 'generate-hashrate-user-insert-5m',
  text: format(query_generate_hashrate_user_insert, 'hashrate_5min')
}

const query_generate_hashrate_user_insert_1hr = {
  name: 'generate-hashrate-user-insert-1hr',
  text: format(query_generate_hashrate_user_insert, 'hashrate_1hr')
}

const query_generate_hashrate_pool_insert = `
INSERT INTO %s
  SELECT
  -1 AS uid,
  0 AS rid,
  SUM(CASE WHEN row_number = 1 THEN 0 ELSE count END),
  t,
  MIN(time),
  MAX(time)
  FROM generate_series(($1)::INT, ($2)::INT, ($3)::INT) AS t
  LEFT JOIN LATERAL (
    SELECT
    count,
    time,
    ROW_NUMBER() OVER(ORDER BY time ASC) AS row_number
    FROM
    valid_shares
    WHERE time BETWEEN (t - $4) AND t
    ORDER BY time ASC
  ) shares ON time BETWEEN (t - $4) AND t
  GROUP BY t
  ORDER BY t ASC
ON CONFLICT DO NOTHING
`
const query_generate_hashrate_pool_insert_5m = {
  name: 'generate-hashrate-pool-insert-5m',
  text: format(query_generate_hashrate_pool_insert, 'hashrate_5min')
}

const query_generate_hashrate_pool_insert_1hr = {
  name: 'generate-hashrate-pool-insert-1hr',
  text: format(query_generate_hashrate_pool_insert, 'hashrate_1hr')
}

const query_get_hashrate = `
SELECT (t + 1262304000) AS t, COALESCE(y, 0) AS y
FROM generate_series(($1)::INT, LEAST((SELECT MAX(tsample) FROM %s), ($2)::INT), ($3)::INT) AS t
LEFT JOIN (
  SELECT
  tsample,
  SUM(CASE WHEN tsample = tstart THEN 0 ELSE count::FLOAT / (tsample - tstart) END) as y
  FROM %s
  WHERE tsample BETWEEN $1 AND $2 AND uid = $4
  GROUP BY tsample
) samples ON tsample = t
`

const query_get_hashrate_5m = {
  name: 'get-hashrate-5m',
  text: format(query_get_hashrate, 'hashrate_5min', 'hashrate_5min')
}

const query_get_hashrate_1hr = {
  name: 'get-hashrate-1hr',
  text: format(query_get_hashrate, 'hashrate_1hr', 'hashrate_1hr')
}

// This function calculates hashrate data points from the valid_shares table
// resolution can be '5m' or '1hr'
// 5m is sampling every five minutes for a fifteen minute period
// 1hr is sampling hashrate every hour for an hour long period
export function generateHashrate(resolution) {
  return new Promise((resolve, reject) => {
    let query1, query2, query3, interval, period
    if(resolution === '5m') {
      query1 = query_generate_hashrate_min_max_5m.text
      query2 = query_generate_hashrate_pool_insert_5m.text
      query3 = query_generate_hashrate_user_insert_5m.text
      interval = 60 * 5
      period = 60 * 15
    } else if(resolution === '1hr') {
      query1 = query_generate_hashrate_min_max_1hr.text
      query2 = query_generate_hashrate_pool_insert_1hr.text
      query3 = query_generate_hashrate_user_insert_1hr.text
      interval = 60 * 60
      period = 60 * 60
    } else {
      return resolve()
    }
    pool.query(query1).then(res => {
      if(res.rows.length !== 1) {
        return resolve()
      }
      const result = res.rows[0]

      if(result.min === null || result.max === null) {
        return resolve()
      }
      // Round min up an interval and max down an interval
      const start = result.min - result.min % interval + interval
      const end   = result.max - result.max % interval

      if(end < start) {
        return resolve()
      }

      Promise.all([
        pool.query(query2, [start, end, interval, period]),
        pool.query(query3, [start, end, interval, period])
      ]).then(res => {
        logger.log('info', 'graphs', 'Generated %s hashrate graphs for period %d - %d', [resolution, start, end])
      }).catch(error => {
        logger.log('error', 'graphs', 'Failed to generate %s hashrate graphs for period %d - %d', [resolution, start, end])
        logger.log('error', 'graphs', error)
      }).finally(() => {
        resolve()
      })
    }).catch(error => {
      logger.log('error', 'graphs', 'Failed to generate %s hashrate graphs', [resolution])
      logger.log('error', 'graphs', error)
    }).finally(() => {
      resolve()
    })
  })
}

// Get hashrate from cache table
// length can be 24h, 7d, or 30d
// if uid is null, get the pool hashrate graph
export function getHashrate(length, uid=-1) {
  let data = [], query, start, end, interval
  const now = time.now()

  if(length === '24hr') {
    // end will be now rounded down to 5 minutes
    end = time.start_of_5_min(now)
    // start will be 24 hrs before end
    start = end - 24 * 60 * 60
    // interval will be 5 mins
    interval = 5 * 60
    query = query_get_hashrate_5m.text
  } else if(length === '7d') {
    // end will be now rounded down to the last hour
    end = time.start_of_1_hr(now)
    // start will be 7 days before end
    start = end - 7 * 24 * 60 * 60
    // interval will be 1 hour
    interval = 60 * 60
    query = query_get_hashrate_1hr.text
  } else if(length === '30d') {
    // end will be now rounded down to the last hour
    end = time.start_of_1_hr(now)
    // start will be 30 days before end
    start = end - 30 * 24 * 60 * 60
    // interval will be 1 hour
    interval = 60 * 60
    query = query_get_hashrate_1hr.text
  } else {
    return data
  }

  start = time.walltime_to_db_time(start)
  end = time.walltime_to_db_time(end)

  let params = [start, end, interval, uid]
  return pool.query(query, params).then(res => {
    data = res.rows
    return data
  }).catch(error => {
    logger.log('error', 'graphs', 'Failed to get hashrate graph length %s, uid %d', [length, uid])
    logger.log('error', 'graphs', error)
    return data
  })
}

// Returns array of { t, y } for network blocks in the last 24 horus
// Takes into account orphan blocks
export function getNetworkHashrate24hr() {
  let data = []
  const ago24hours = time.walltime_to_db_time(time.now()) - 24 * 60 * 60
  return pool.query('SELECT * FROM network_blocks WHERE time >= $1 ORDER BY height DESC', [ago24hours]).then(res => {
    let prev_id = null
    res.rows.forEach(row => {
      if(prev_id === null || prev_id === row.blkid) {
        prev_id = row.prev_id
        data.push({
          t: time.db_time_to_walltime(row.time),
          y: Math.round(100 * row.difficulty / coin.coin_difficulty_target ) / 100
        })
      }
    })
    return data.reverse()
  }).catch(error => {
    logger.log('error', 'graphs', 'Error getting 24h network hashrate graph')
    logger.log('error', 'graphs', error)
    return data.reverse()
  })
}

// Returns array of { t, y } for network blocks in the last 7 days
// Only returns blocks that are divisible by 7 to cut down on number of points
export function getNetworkHashrate7d() {
  let data = []
  const ago7days = time.walltime_to_db_time(time.now()) - 7 * 24 * 60 * 60
  return pool.query('SELECT * FROM network_blocks WHERE time >= $1 AND height % 7 = 0 ORDER BY height ASC', [ago7days]).then(res => {
    res.rows.forEach(row => {
      data.push({
        t: time.db_time_to_walltime(row.time),
        y: Math.round(100 * row.difficulty / coin.coin_difficulty_target ) / 100
      })
    })
    return data
  }).catch(error => {
    logger.log('error', 'graphs', 'Error getting 7d network hashrate graph')
    logger.log('error', 'graphs', error)
    return data
  })
}

// Returns array of { t, y } for network blocks in the last 30 days
// Only returns blocks that are divisible by 30 to cut down on number of points
export function getNetworkHashrate30d() {
  let data = []
  const ago30days = time.walltime_to_db_time(time.now()) - 30 * 24 * 60 * 60
  return pool.query('SELECT * FROM network_blocks WHERE time >= $1 AND height % 30 = 0 ORDER BY height ASC', [ago30days]).then(res => {
    res.rows.forEach(row => {
      data.push({
        t: time.db_time_to_walltime(row.time),
        y: Math.round(100 * row.difficulty / coin.coin_difficulty_target ) / 100
      })
    })
    return data
  }).catch(error => {
    logger.log('error', 'graphs', 'Error getting 30 network hashrate graph')
    logger.log('error', 'graphs', error)
    return data
  })
}
