import logger from '../logger'

import * as stats from '.'

import { pool } from '../database'
import * as time from '../time'

const query_get_users = {
  name: 'get-users',
  text: `
  SELECT
  users.*,
  rigs.rigs_rid,
  rigs.rigs_name,
  user_ban.ban_lift_time,
  user_ban.ban_msg
  FROM users
  LEFT JOIN (
    SELECT
    uid,
    array_agg(rid) AS rigs_rid,
    array_agg(name) AS rigs_name
    FROM
    rigs
    GROUP BY uid
  ) rigs ON rigs.uid = users.uid
  LEFT JOIN (
    SELECT
    uid,
    array_agg(lift_time) AS ban_lift_time,
    array_agg(msg) AS ban_msg
    FROM user_ban
    GROUP BY uid
  ) user_ban ON user_ban.uid = users.uid
  `
}

export function getUsers() {
  const now = time.now()
  return pool.query(query_get_users).then(res => {
    return new Map(res.rows.map(row => {
      row.payment_threshold = parseInt(row.payment_threshold) || 0
      row.rigs_rid = row.rigs_rid ? row.rigs_rid : []
      row.rigs_name = row.rigs_name ? row.rigs_name : []
      row.ban_lift_time = row.ban_lift_time ? row.ban_lift_time.map(lift_time => time.db_time_to_walltime(lift_time)) : []
      row.ban_msg = row.ban_msg ? row.ban_msg : []
      row.is_banned = row.ban_lift_time.some(lift_time => lift_time > now)
      return [row.uid, row]
    }))
  })
}

export function getUserByUsername(username) {
  return pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]).then(res => {
    if(res.rows.length) {
      return res.rows[0]
    }
    return false
  })
}

export function getTopUsers(count = 10) {
  const { users, users_rigs, users_hashrate_15m } = stats.getMemCache()
  const top_hashrates = [...users_hashrate_15m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, count)
  let top_miners = []
  let n = 1
  for(const top_hashrate of top_hashrates) {
    const uid = top_hashrate[0]
    const hashrate = top_hashrate[1].total
    if(uid === -1 || hashrate === 0) {
      continue
    }
    const user = users.get(uid)
    const username = user.anon_leader ? 'anon' : user.username
    const last_share = Math.max(...users_rigs.get(uid).map(rig => rig.last_share), 0)
    top_miners.push({
      number: n++,
      username,
      hashrate,
      last_share,
    })
  }
  return top_miners
}

const query_get_user_balances = {
  name: 'get-user-balances',
  text: `
  SELECT
  info.uid,
  info.wallet,
  info.payment_threshold,
  credits_pending.reward AS credits_pending_reward,
  credits_pending.admin AS credits_pending_admin,
  credits_pending.bonus AS credits_pending_bonus,
  credits_pending.dev AS credits_pending_dev,
  credits_matured.reward AS credits_matured_reward,
  credits_matured.admin AS credits_matured_admin,
  credits_matured.bonus AS credits_matured_bonus,
  credits_matured.dev AS credits_matured_dev,
  debits.paid AS debits_paid,
  debits.admin AS debits_admin,
  debits.fee AS debits_fee
  FROM (
    SELECT
    uid,
    payment_threshold,
    wallet
    FROM users
  ) AS info
  LEFT JOIN (
    SELECT
    uid,
    SUM(COALESCE(CASE WHEN blk_id > 0 THEN amount_reward ELSE 0 END, 0)) as reward,
    SUM(COALESCE(CASE WHEN blk_id < 0 THEN amount_reward ELSE 0 END, 0)) as admin,
    SUM(COALESCE(amount_bonus, 0)) as bonus,
    SUM(COALESCE(amount_dev, 0)) as dev
    FROM credits
    WHERE status = 0
    GROUP BY uid
  ) AS credits_pending ON credits_pending.uid = info.uid
  LEFT JOIN (
    SELECT
    uid,
    SUM(COALESCE(CASE WHEN blk_id > 0 THEN amount_reward ELSE 0 END, 0)) as reward,
    SUM(COALESCE(CASE WHEN blk_id < 0 THEN amount_reward ELSE 0 END, 0)) as admin,
    SUM(COALESCE(amount_bonus, 0)) as bonus,
    SUM(COALESCE(amount_dev, 0)) as dev
    FROM credits
    WHERE status = 1
    GROUP BY uid
  ) AS credits_matured ON credits_matured.uid = info.uid
  LEFT JOIN (
    SELECT
    uid,
    SUM(COALESCE(CASE WHEN txid IS NOT NULL THEN payments.amount_paid ELSE 0 END, 0)) as paid,
    SUM(COALESCE(CASE WHEN txid IS NULL THEN payments.amount_paid ELSE 0 END, 0)) as admin,
    SUM(COALESCE(payments.amount_fee, 0)) as fee
    FROM payments
    WHERE status <> -1
    GROUP BY uid
  ) AS debits ON debits.uid = info.uid
  `
}

export function getUserBalances() {
  let users_balance = new Map()
  let balances_by_type = {
    credits_pending_reward: 0,
    credits_pending_bonus: 0,
    credits_pending_dev: 0,
    credits_matured_reward: 0,
    credits_matured_bonus: 0,
    credits_matured_dev: 0,
    debits_paid: 0,
    debits_fee: 0,
    credits_pending: 0,
    credits_matured: 0,
    debits: 0,
  }

  users_balance.set(-1, {
    ...balances_by_type,
    uid: null,
    wallet: null,
    payment_threshold: null
  })

  return pool.query(query_get_user_balances.text).then(res => {
    for(const user of res.rows) {
      let user_balance = {}, credits_pending = 0, credits_matured = 0, debits = 0
      for(const col in user) {
        const int_val = parseInt(user[col]) || 0
        if(col.startsWith('credits_pending_')) {
          user_balance[col] = int_val
          credits_pending += int_val
        } else if(col.startsWith('credits_matured_')) {
          user_balance[col] = int_val
          credits_matured += int_val
        } else if(col.startsWith('debits_')) {
          user_balance[col] = int_val
          debits += int_val
        } else if(col === 'payment_threshold') {
          user_balance[col] = int_val
        } else {
          user_balance[col] = user[col]
        }
      }

      users_balance.set(user.uid, {
        ...user_balance,
        credits_pending,
        credits_matured,
        debits
      })
    }
    return { users_balance }
  }).catch(error => {
    logger.log('error', 'users', 'Error getting user balances')
    logger.log('error', 'users', error)
    return { users_balance }
  })
}

// Get hashrates grouped by uid and rid
const query_get_users_hashrates = {
  name: 'get-users-hashrates',
  text: `
  SELECT
  rigs.uid,
  rigs.rid,
  MIN(time) AS tstart,
  MAX(time) AS tend,
  SUM(CASE WHEN row_number = 1 THEN 0 ELSE count END) AS count
  FROM rigs
  LEFT JOIN (
    SELECT
    uid,
    rid,
    count,
    time,
    ROW_NUMBER() OVER(PARTITION BY uid, rid ORDER BY time ASC) AS row_number
    FROM
    valid_shares
    WHERE time BETWEEN ($1::INT - $2::INT) AND $1::INT
    ORDER BY time ASC
  ) shares ON rigs.uid = shares.uid AND rigs.rid = shares.rid
  GROUP BY 1, 2
  `
}

export function getUsersHashrates(duration) {
  let users_hashrate = new Map([[ -1, { total: 0 } ]])

  const tsample = time.walltime_to_db_time(time.now())
  return pool.query(query_get_users_hashrates.text, [tsample, duration]).then(res => {
    res.rows.forEach(row => {
      const { uid, rid, tstart, tend, count } = row

      // create key in map for user if not existing
      if(!users_hashrate.has(uid)) {
        users_hashrate.set(uid, {
          total: 0
        })
      }
      // get user obj, will hold rigs
      let user_obj = users_hashrate.get(uid)

      // calculate hashrate
      let hashrate = 0
      if(tstart !== tsample) {
        hashrate = Math.round(count / (tsample - tstart))
      }
      // Add this rig to the user's list
      user_obj[rid] = hashrate
      // add hashrate to user total hashrate
      user_obj.total += hashrate
    })
    return users_hashrate
  }).catch(error => {
    logger.log('error', 'users', 'Error getting user hashrates')
    logger.log('error', 'users', error)
    return users_hashrate
  })
}

// Get rigs with last_share time
const query_get_rigs = {
  name: 'get-rigs',
  text: `
  SELECT
  rigs.uid,
  rigs.rid,
  rigs.name,
  shares.last_share
  FROM rigs
  LEFT JOIN (
    SELECT
    uid,
    rid,
    MAX(time) as last_share
    FROM
    valid_shares
    GROUP BY 1, 2
  ) shares ON rigs.uid = shares.uid AND rigs.rid = shares.rid
  `
}

export function getRigs() {
  let active = { miners: 0, workers: 0 }
  let users_rigs = new Map([[ -1, [] ]])

  // tmp variable to know track if a user is active
  let uid_is_active = new Map()

  const ago15mins = time.now() - 900
  return pool.query(query_get_rigs).then(res => {
    res.rows.forEach(row => {
      const { uid, rid, name } = row
      const last_share = time.db_time_to_walltime(row.last_share)
      const is_active = last_share > ago15mins

      // create key in map for user if not existing
      if(!users_rigs.has(uid)) {
        users_rigs.set(uid, [])
      }
      // get user arr, will hold rigs
      let user_rigs = users_rigs.get(uid)

      // Add this rig to the user's list
      user_rigs.push({ rid, name, last_share, is_active })

      // increment global active workers
      if(is_active) {
        if(!uid_is_active.has(uid) && is_active) {
          active.miners++
          uid_is_active.set(uid, true)
        }
        active.workers++
      }
    })
    return { active, users_rigs }
  }).catch(error => {
    logger.log('error', 'users', 'Error getting user rigs')
    logger.log('error', 'users', error)
    return { active, users_rigs }
  })
}

export function getTotalSharesSince(start_time) {
  start_time = time.walltime_to_db_time(start_time)
  const users_shares = new Map([[ -1, 0 ]])

  return pool.query('SELECT uid, SUM(count) FROM valid_shares WHERE time > $1 GROUP BY uid', [start_time]).then(res => {
    res.rows.forEach(row => {
      const { uid, sum } = row
      users_shares.set(uid, sum)
    })
    return users_shares
  }).catch(error => {
    logger.log('error', 'users', 'Failed to get total shares since %d', [start_time])
    logger.log('error', 'users', error)
    return users_shares
  })
}
