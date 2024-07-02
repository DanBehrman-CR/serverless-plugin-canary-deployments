import expect from 'chai'
import fp from 'lodash'
import Iot from './Iot'

describe('Iot', () => {
  const iotTopicRule = {
    Type: 'AWS::IoT::TopicRule',
    Properties: {
      TopicRulePayload: {
        RuleDisabled: 'false',
        Sql: "SELECT * FROM 'some_topic'",
        Actions: [
          {
            Lambda: {
              FunctionArn: {
                'Fn::GetAtt': [
                  'HelloLambdaFunction',
                  'Arn'
                ]
              }
            }
          }
        ]
      }
    }
  }

  describe('.replaceIotTopicRuleActionArnWithAlias', () => {
    it('replaces the IoT topic rule action with a function alias ARN', () => {
      const functionAlias = 'TheFunctionAlias'
      const ruleAction = { Ref: functionAlias }
      const expected = fp.set(
        'Properties.TopicRulePayload.Actions[0].Lambda.FunctionArn',
        ruleAction,
        iotTopicRule
      )
      const actual = Iot.replaceIotTopicRuleActionArnWithAlias(iotTopicRule, functionAlias)
      expect(actual).to.deep.equal(expected)
    })
  })
})
