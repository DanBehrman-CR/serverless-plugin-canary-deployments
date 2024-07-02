import fp from 'lodash'

function replaceIotTopicRuleActionArnWithAlias (iotTopicRule, functionAlias) {
  const newRule = fp.set(
    'Properties.TopicRulePayload.Actions[0].Lambda.FunctionArn',
    { Ref: functionAlias },
    iotTopicRule
  )
  return newRule
}

const Iot = {
  replaceIotTopicRuleActionArnWithAlias
}

export default Iot
