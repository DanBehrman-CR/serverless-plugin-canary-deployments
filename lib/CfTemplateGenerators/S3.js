import fp from 'lodash'

function replaceS3BucketFunctionWithAlias (bucket, functionAlias, functionName) {
  const lambdaConfigurations = fp.get('Properties.NotificationConfiguration.LambdaConfigurations', bucket)
  const findTargetFunction = (configuration) => {
    const thisFunctionName = fp.get('Function.Fn::GetAtt[0]', configuration)
    return thisFunctionName === functionName
  }
  const index = fp.findIndex(findTargetFunction, lambdaConfigurations)
  return fp.set(['Properties', 'NotificationConfiguration', 'LambdaConfigurations', index, 'Function'], { Ref: functionAlias }, bucket)
}

const S3 = {
  replaceS3BucketFunctionWithAlias
}

export default S3
