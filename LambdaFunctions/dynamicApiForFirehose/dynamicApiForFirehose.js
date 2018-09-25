const aws=require('aws-sdk');

exports.handler = (event, context, callback) => {
    
    var apigateway = new aws.APIGateway({apiVersion: '2015-07-09'});
    var region=aws.config.region;
    var api={};
    
    //Creates REST API with EDGE configuration
    var pcreate= new Promise(function(resolve,reject){
        var params = {
            name: event.alias, /* required */
            endpointConfiguration: {
                types: [
                    'EDGE'
                ]
          }
        };
        apigateway.createRestApi(params, function(err, data) {
          if (err)  reject(err);
          else{
            api.id=data.id;
            resolve(api.id);
            }
        });
    });
        
    //Creates a distribution domain name using given SSL certificate (the cretificate must be located in us-east-1 region).
    //The domain name is using form api.[alias].[domain]
    var pdomain= new Promise(function(resolve,reject){
        var params = {
            domainName: event.alias+'.' +event.domain, /* required */
            certificateArn: event.certificate,
            endpointConfiguration: {
              types: [
                'EDGE'
                /* more items */
              ]
            }
          };
          apigateway.createDomainName(params, function(err, data) {
          if (err) reject(err);
          else {    
              api.domain=data.distributionDomainName;
              resolve(api.domain);
          }
        });
    });
            
    //Creates API key
    var papiKey= new Promise(function(resolve,reject){
          var params = {
              name: event.alias,
              enabled: true
          };
          apigateway.createApiKey(params, function(err, data) {
            if (err) {
                reject(err);
            }else{
              api.key={
                  id:data.id,
                  value:data.value
              };
              resolve(api.key);
              }
          });
      });
      
    Promise.all([pcreate, pdomain, papiKey]).then(function(response){  
      //Reterieves API resources
      var pbase= new Promise(function(resolve,reject){
        var params = {
          restApiId: api.id /* required */
        };
        apigateway.getResources(params, function(err, data) {
          if (err) reject(err);
          else { 
            api.base={id:data.items[0].id};
            resolve();
          }
        });
      });
      
      //Creates CNAME recordset for the API domain in a given hosted zone
      var palias= new Promise(function(resolve,reject){
        var route53 = new aws.Route53({apiVersion: '2013-04-01'});
        var params = {
            ChangeBatch: {
             Changes: [
                {
               Action: "CREATE", 
               ResourceRecordSet: {
                Name: event.alias+"."+event.domain,
                Type: "CNAME",
                TTL:300,
                ResourceRecords: [
                  {
                    Value: api.domain
                  },
                ],
               }
              }
            ]},
              HostedZoneId: event.hostedZone
          };
           route53.changeResourceRecordSets(params, function(err, data) {
            if (err) reject(err);
            else  resolve();
          });  
        });
        Promise.all([pbase,palias]).then(function(response){      
          //Creates api resource with a dynamic path
          var papi= new Promise(function(resolve,reject){
            var params = {
              parentId: api.base.id, /* required */
              pathPart: '{delivery-stream-name}', /* required */
              restApiId: api.id /* required */
            };
            apigateway.createResource(params, function(err, data) {
              if (err) reject(err);
              else {    
                  api.resource={id:data.id};
                  resolve();
              }
            });
          });
          papi.then(function(response){        
            //Creates a post method for the dynamic API resource that requires an API key
            var pmethod= new Promise(function(resolve,reject){
                var params = {
                  authorizationType: 'NONE', /* required */
                  httpMethod: 'POST', /* required */
                  resourceId: api.resource.id, /* required */
                  restApiId: api.id, /* required */
                  apiKeyRequired: true
                };
                apigateway.putMethod(params, function(err, data) {
                  if (err) reject(err);
                  else{
                      api.httpMethod=data.httpMethod;
                      resolve();
                  }
                });
            });
            pmethod.then(function(response){
                
              //Creates a development stage for the API
              var pstage= new Promise(function(resolve,reject){
                var params = {
                  restApiId: api.id,
                  stageName: event.stageName
                };
                apigateway.createDeployment(params, function(err, data) {
                  if (err) {
                        console.log(err, err.stack); // an error occurred
                        reject(err);
                      }
                  else     {
                    resolve();
                  }
                });
              });        
              //Creates an integration for the POST method that puts request data in JSON form into Kinesis Firehose stream specified in the dynamic part of the path
              var pintegration= new Promise(function(resolve,reject){
                var params = {
                    httpMethod: 'POST', /* required */
                    resourceId: api.resource.id, /* required */
                    restApiId: api.id, /* required */
                    type: 'AWS', /* required */
                    credentials: event.kinesisRole,
                    uri: 'arn:aws:apigateway:'+region+':firehose:action/PutRecord',
                    integrationHttpMethod: 'POST',
                    requestParameters: {
                      "integration.request.header.Content-Type":"'application/x-amz-json-1.1'"
                    },
                    requestTemplates:{
                      "application/json": 
                        `{\"DeliveryStreamName\": \"$input.params('delivery-stream-name')\",\n
                        \"Record\": { \"Data\": \"$util.base64Encode($input.body)\" }}`
                    }
                  };
                  apigateway.putIntegration(params, function(err, data) {
                    if (err) reject(err);
                    else resolve();
                });
              });
              Promise.all([pstage, pintegration]).then(function(response){
              
                //Creates basic response for the POST method integration
                var pintegrationResponse= new Promise(function(resolve,reject){
                  var params = {
                      httpMethod: 'POST', /* required */
                      resourceId: api.resource.id, /* required */
                      restApiId: api.id, /* required */
                      statusCode: "200"
                    };
                    apigateway.putIntegrationResponse(params, function(err, data) {
                      if (err)  reject(err);
                      else resolve();
                  });
                });
                
                //Creates basic response for the POST method
                var pmethodResponse= new Promise(function(resolve,reject){
                  var params = {
                      httpMethod: 'POST', /* required */
                      resourceId: api.resource.id, /* required */
                      restApiId: api.id, /* required */
                      statusCode: "200"
                    };
                    console.log(params);
                    apigateway.putMethodResponse(params, function(err, data) {
                      if (err) reject(err);
                      else resolve();
                  });
                });              
                //Creates a usage plan for the API stage
                var pusagePlan= new Promise(function(resolve,reject){
                var params = {
                  name: event.alias, /* required */
                  apiStages: [
                    {
                      apiId: api.id,
                      stage: event.stageName
                    },
                  ]
                };
                apigateway.createUsagePlan(params, function(err, data) {
                  if (err) reject(err);
                  else     {
                    api.usagePlan=data.id;
                    resolve();
                  }
                });
              });
                
              //Creates base path mapping that attaches the domain name to the api stage
              var pbasePath= new Promise(function(resolve,reject){
                var params = {
                  domainName: event.alias+"." +event.domain, /* required */
                  restApiId: api.id, /* required */
                  stage: event.stageName
                };
                apigateway.createBasePathMapping(params, function(err, data) {
                  if (err) reject(err);
                  else resolve();
                  });  
              });
              Promise.all([pintegrationResponse,pmethodResponse,pusagePlan, pbasePath]).then(function(response){
              
              //Attaches the api key to the usage plan
              var params = {
                keyId: api.key.id, /* required */
                keyType: 'API_KEY', /* required */
                usagePlanId: api.usagePlan /* required */
              };
              apigateway.createUsagePlanKey(params, function(err, data) {
                if (err) callback(err);
                else callback(null,api);
              });
              }).catch(function(error) {
                callback(error);
              });
            }).catch(function(error) {
              callback(error);
            });
          }).catch(function(error) {
              callback(error);
          });
        }).catch(function(error) {
            callback(error);
        });
      }).catch(function(error) {
          callback(error);
      });
    }).catch(function(error) {
        callback(error);
    });
};
