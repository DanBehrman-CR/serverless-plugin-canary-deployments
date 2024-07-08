import fp from 'lodash'

function buildUriForAlias (functionAlias) {
  const aliasArn = [
    'arn:aws:apigateway:',
    { Ref: 'AWS::Region' },
    ':lambda:path/2015-03-31/functions/',
    { Ref: functionAlias },
    '/invocations'
  ]
  return { 'Fn::Join': ['', aliasArn] }
}

function buildV2UriForAlias (functionAlias) {
  const aliasArn = [
    'arn:',
    { Ref: 'AWS::Partition' },
    ':apigateway:',
    { Ref: 'AWS::Region' },
    ':lambda:path/2015-03-31/functions/',
    { Ref: functionAlias },
    '/invocations'
  ]
  return { 'Fn::Join': ['', aliasArn] }
}

function replaceV2IntegrationUriWithAlias (apiGatewayMethod, functionAlias) {
  const aliasUri = buildV2UriForAlias(functionAlias)
  const newMethod = fp.set('Properties.IntegrationUri', aliasUri, apiGatewayMethod)
  return newMethod
}

function replaceMethodUriWithAlias (apiGatewayMethod, functionAlias) {
  const aliasUri = buildUriForAlias(functionAlias)
  const newMethod = fp.set('Properties.Integration.Uri', aliasUri, apiGatewayMethod)
  return newMethod
}

function replaceV2AuthorizerUriWithAlias (apiGatewayMethod, functionAlias) {
  const aliasUri = buildV2UriForAlias(functionAlias)
  const newMethod = fp.set('Properties.AuthorizerUri', aliasUri, apiGatewayMethod)
  return newMethod
}

const ApiGateway = {
  replaceV2IntegrationUriWithAlias,
  replaceMethodUriWithAlias,
  replaceV2AuthorizerUriWithAlias
}

export default ApiGateway
