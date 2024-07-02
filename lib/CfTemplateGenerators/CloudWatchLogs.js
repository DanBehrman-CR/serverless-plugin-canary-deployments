import fp from 'lodash'

function replaceCloudWatchLogsDestinationArnWithAlias (cloudWatchLogs, functionAlias, functionName) {
  const targetArn = cloudWatchLogs.Properties.DestinationArn || {}
  const targetDetails = (targetArn['Fn::GetAtt'] || [])
  const [funcName] = targetDetails
  if (funcName && funcName === functionName) {
    return fp.set('Properties.DestinationArn', { Ref: functionAlias }, cloudWatchLogs)
  }
  return cloudWatchLogs
}

const CloudWatchLogs = {
  replaceCloudWatchLogsDestinationArnWithAlias
}

export default CloudWatchLogs
