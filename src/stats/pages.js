import { BLOCK_CACHE, BLOCK_PAGE, PAYMENT_CACHE, PAYMENT_PAGE, CREDITS_DEBITS_PAGE, SHARES_PAGE } from '../constants'

import * as stats from '.'
import * as graphs from './graphs'

import { pool } from '../database'
import logger from '../logger'
import * as time from '../time'

export async function getBlocks(page) {
  if(page < BLOCK_CACHE / BLOCK_PAGE) {
    const { blocks, blocks_count } = stats.getMemCache()
    return {
      data: blocks.slice(page * BLOCK_PAGE, (page + 1) * BLOCK_PAGE),
      total: blocks_count
    }
  } else {
    const { blocks, blocks_count } = await getBlocksPaged(page)
    return {
      data: blocks,
      total: blocks_count
    }
  }
}

const query_get_blocks_paged = {
  name: 'get-blocks-paged',
  text: `
  SELECT *,
  COUNT(*) OVER() AS total_count
  FROM mined_blocks
  LEFT JOIN users ON mined_blocks.uid = users.uid
  ORDER BY height DESC
  LIMIT $1 OFFSET $2
  `
}

export function getBlocksPaged(page, page_size=15) {
  let blocks = []
  let blocks_count = 0
  return pool.query(query_get_blocks_paged.text, [page_size, page]).then(res => {
    res.rows.forEach(row => {
      blocks_count = parseInt(row.total_count) || 0
      blocks.push({
        blk_id: row.blk_id,
        txid: row.txid,
        height: row.height,
        time: time.db_time_to_walltime(row.time),
        reward: parseInt(row.reward_total) || 0,
        total_shares: row.status > 0 ? row.total_shares : 0,
        difficulty: row.difficulty,
        status: row.status,
        miner: row.anon_leader ? 'anon' : row.username
      })
    })
    return { blocks, blocks_count }
  }).catch(error => {
    logger.log('error', 'pages', 'Error getting blocks')
    logger.log('error', 'pages', error)
    return { blocks, blocks_count }
  })
}

export async function getPayments(page) {
  if(page < PAYMENT_CACHE / PAYMENT_PAGE) {
    const { payments, payments_count } = stats.getMemCache()
    return {
      data: payments.slice(page * PAYMENT_PAGE, (page + 1) * PAYMENT_PAGE),
      total: payments_count
    }
  } else {
    const { payments, payments_count } = await getPaymentsPaged(page)
    return {
      data: payments,
      total: payments_count
    }
  }
}

const query_get_payments_paged = {
  name: 'get-payments-paged',
  text: `
  SELECT
  txid,
  MIN(time) AS time,
  MIN(status) AS status,
  SUM(amount_paid) AS paid,
  SUM(amount_fee) AS fee,
  COUNT(uid) AS payees,
  ROW_NUMBER() OVER(ORDER BY time ASC) AS payment_number,
  COUNT(*) OVER() AS total_count
  FROM payments
  WHERE txid IS NOT NULL
  GROUP BY txid, time
  ORDER BY payment_number DESC
  LIMIT $1 OFFSET $2
  `
}

export function getPaymentsPaged(page, page_size=15) {
  let payments = []
  let payments_count = 0
  return pool.query(query_get_payments_paged.text, [page_size, page]).then(res => {
    res.rows.forEach(row => {
      payments_count = row.total_count
      payments.push({
        payment_number: row.payment_number,
        txid: row.txid,
        status: row.status,
        paid: row.paid,
        fee: row.fee,
        payees: row.payees,
        time: time.db_time_to_walltime(row.time)
      })
    })
    return { payments, payments_count }
  }).catch(error => {
    logger.log('error', 'pages', 'Error getting payments')
    logger.log('error', 'pages', error)
    return { payments, payments_count }
  })
}


export async function getCreditsDebits(page, uid) {
  return await getUserCreditsDebitsPaged(uid, page * CREDITS_DEBITS_PAGE, CREDITS_DEBITS_PAGE)
}

const query_get_user_credits_debits = {
  name: 'get-user-credits-debits',
  text: `
  SELECT t1.*, mined_blocks.height AS height, count(*) OVER() AS total_count, SUM(CASE WHEN t1.status != -1 THEN amount ELSE 0 END) OVER (ORDER BY t1.time ASC, t1.blk_id ASC, t1.type ASC) AS running_total
  FROM (
    SELECT blk_id, NULL::text as txid, amount_reward AS amount, time, status, 'credit_reward' as type
    FROM credits
    WHERE uid = $1 AND amount_reward IS NOT NULL AND blk_id > 0

    UNION ALL

    SELECT blk_id, NULL::text as txid, amount_reward AS amount, time, status, 'credit_admin' as type
    FROM credits
    WHERE uid = $1 AND amount_reward IS NOT NULL AND blk_id < 0

    UNION ALL

    SELECT blk_id, NULL::text as txid, amount_bonus AS amount, time, status, 'credit_bonus' as type
    FROM credits
    WHERE uid = $1 AND amount_bonus IS NOT NULL

    UNION ALL

    SELECT blk_id, NULL::text as txid, amount_dev AS amount, time, status, 'credit_dev' as type
    FROM credits
    WHERE uid = $1 AND amount_dev IS NOT NULL

    UNION ALL

    SELECT NULL::integer as blk_id, txid, amount_paid * (-1) AS amount, time, status, 'debit_payment' as type
    FROM payments
    WHERE uid = $1 AND txid IS NOT NULL

    UNION ALL

    SELECT NULL::integer as blk_id, txid, amount_paid * (-1) AS amount, time, status, 'debit_admin' as type
    FROM payments
    WHERE uid = $1 AND txid IS NULL

    UNION ALL

    SELECT NULL::integer as blk_id, txid, amount_fee * (-1) AS amount, time, status, 'debit_fee' as type
    FROM payments
    WHERE uid = $1 AND txid IS NOT NULL
  ) AS t1

  LEFT JOIN mined_blocks ON t1.blk_id = mined_blocks.blk_id

  ORDER BY time DESC, blk_id DESC, type DESC
  LIMIT $2 OFFSET $3
  `
}

export function getUserCreditsDebitsPaged(uid, page, page_size=15) {
  let credits_debits = []
  let num_rows = 0
  return pool.query(query_get_user_credits_debits.text, [uid, page_size, page]).then(res => {
    res.rows.forEach(row => {
      num_rows = row.total_count
      credits_debits.push({
        blk_id: row.blk_id,
        height: row.height,
        txid: row.txid,
        amount: row.amount,
        running_total: row.running_total,
        type: row.type,
        time: time.db_time_to_walltime(row.time),
        status: row.status
      })
    })
    return { data: credits_debits, total: num_rows }
  }).catch(error => {
    logger.log('error', 'pages', 'Error getting user credits / debits')
    logger.log('error', 'pages', error)
    return { data: credits_debits, total: num_rows }
  })
}

export async function getHashrateGraph(type, length, uid=null) {
  if(length !== '24hr' && length !== '7d' && length !== '30d') {
    length = '24hr'
  }
  let data
  if(type === 'pool_hashrate_graph') {
    const mem_cache = stats.getMemCache()
    data = mem_cache['pool_hashrate_graph_' + length]
  } else if(type === 'network_hashrate_graph') {
    const mem_cache = stats.getMemCache()
    data = mem_cache['network_hashrate_graph_' + length]
  } else if(type === 'user_hashrate_graph') {
    data = uid === null ? [] : await graphs.getHashrate(length, uid)
  } else {
    data = []
  }
  if(data.length === 0) {
    // If no data, return empty graph with start and end points
    const now = time.now()
    let start, end
    if(length === '24hr') {
      end = time.start_of_5_min(now)
      start = end - 24 * 60 * 60
    } else if(length === '7d') {
      end = time.start_of_1_hr(now)
      start = end - 7 * 24 * 60 * 60
    } else if(length === '30d') {
      end = time.start_of_1_hr(now)
      start = end - 30 * 24 * 60 * 60
    }
    data = [
      {
        t: start,
        y: 0,
      },
      {
        t: end,
        y: 0,
      }
    ]
  }
  return { data }
}
