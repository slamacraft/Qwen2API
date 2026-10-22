const express = require('express')
const router = express.Router()
const { apiKeyVerify } = require('../middlewares/authorization.js')
const { processRequestBody } = require('../middlewares/chat-middleware.js')
const { handleResponses } = require('../controllers/responses.js')
const { normalizeResponsesRequest, buildErrorBody } = require('../utils/responses-format.js')
const { logger } = require('../utils/logger.js')

/**
 * 把 Responses 请求体（`input` / `instructions` / `tools` …）转成内部 chat 请求体，
 * 后面直接复用 `/v1/chat/completions` 的 `processRequestBody`（模型映射、工具提示词、
 * 思考开关、多模态解析都在那里面），避免两条链路各写一份。
 *
 * 转换失败要返回 OpenAI 形状的 400：Responses 客户端（SDK / Codex）按
 * `error.message` 读，不能塞 chat 的 `{error:"..."}` 字符串。
 */
const normalizeResponsesBody = (req, res, next) => {
    try {
        const { chatBody, meta } = normalizeResponsesRequest(req.body || {})
        if (!Array.isArray(chatBody.messages) || chatBody.messages.length === 0) {
            return res.status(400).json(buildErrorBody(
                'input 不能为空：需要字符串，或至少一条 message / input_text item',
                { param: 'input', code: 'invalid_input' }
            ))
        }
        if (!chatBody.model) {
            return res.status(400).json(buildErrorBody('缺少 model', { param: 'model', code: 'invalid_model' }))
        }
        req.body = chatBody
        req.responses_meta = meta
        next()
    } catch (error) {
        logger.warn(`Responses 请求体解析失败: ${error.message}`, 'RESPONSES')
        res.status(400).json(buildErrorBody(error.message || '请求体格式不正确', { param: 'input' }))
    }
}

router.post('/v1/responses',
    apiKeyVerify,
    normalizeResponsesBody,
    processRequestBody,
    handleResponses
)

module.exports = router
module.exports.normalizeResponsesBody = normalizeResponsesBody
