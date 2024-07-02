import expect from 'chai'
import CloudWatchLogs from './CloudWatchLogs'

describe('CloudWatchLogs', () => {
  describe('.replaceCloudWatchLogsDestinationArnWithAlias', () => {
    const functionName = 'HelloLambdaFunction'
    const cloudWatchLog = {
      Type: 'AWS::Logs::SubscriptionFilter',
      DependsOn: 'lambdaPermissionLogicalId',
      Properties: {
        LogGroupName: 'logGroupName',
        FilterPattern: 'FilterPattern',
        DestinationArn: {
          'Fn::GetAtt': [functionName, 'Arn']
        }
      }
    }

    it('replaces the log destination arn function for an alias', () => {
      const functionAlias = 'FunctionWithAlias'
      const expected = {
        Type: 'AWS::Logs::SubscriptionFilter',
        DependsOn: 'lambdaPermissionLogicalId',
        Properties: {
          LogGroupName: 'logGroupName',
          FilterPattern: 'FilterPattern',
          DestinationArn: {
            Ref: functionAlias
          }
        }
      }
      const actual = CloudWatchLogs
        .replaceCloudWatchLogsDestinationArnWithAlias(cloudWatchLog, functionAlias, functionName)
      expect(actual).to.deep.equal(expected)
    })
  })
})
