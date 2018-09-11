
const aws=require('aws-sdk');
const cidr=require('node-cidr');

exports.handler = (event, context, callback) => {
    
    var resource={};
    var region=aws.config.region;
    var ec2 = new aws.EC2({apiVersion: '2016-11-15'});
    var subnets=cidr.cidr.subnets(event.cidr,28,16);
    
    //Function to set a default tag to a given resource
    var setTags=function(resource){
        var params = {
            Resources: [resource],
                Tags: [
                    {
                        Key: "Default", 
                        Value: event.tag
                    }
                ]
            };
        ec2.createTags(params, function(err, data) {
            if (err) console.log(err, err.stack); // an error occurred
            else{
                console.log('Tags created to ' + resource);
            }
        });
    };
    
    //Creates a VPC
    var pvpc= new Promise(function(resolve,reject){
        var params = {
          CidrBlock: event.cidr
         };
        ec2.createVpc(params, function(err, data) {
            if (err){
                reject(err);
            }else{
               resource.vpc=data.Vpc.VpcId;
                setTags(resource.vpc);
                resolve(resource.vpc);
            }
        });    
    });
    
    //Creates an internet gateway
    var pig= new Promise(function(resolve,reject){
        var params = {
          DryRun: false,
        };
        ec2.createInternetGateway(params, function(err, data) {
            if (err){
              reject(err);
            }else {
                resource.ig=data.InternetGateway.InternetGatewayId;
                setTags(resource.ig);
                resolve(resource.ig); 
            }
        });
    });
    
    Promise.all([pvpc,pig]).then(function(allData){
        
        //Creates route table
        var prt= new Promise(function(resolve, reject){
            var params = {
                VpcId: resource.vpc
            };
            ec2.createRouteTable(params, function(err, data) {
                if (err) {
                    reject(err);
                }else{
                    resource.rt=data.RouteTable.RouteTableId;
                    setTags(resource.rt);
                    resolve(resource.rt);
                }
            });
        });
        
        //Creates a security group
        var psg= new Promise(function(resolve, reject){
            var params = {
            Description: 'Security Group for VPC '+resource.vpc,
            GroupName: 'security_group_'+resource.vpc,
            DryRun: false,
            VpcId: resource.vpc
            };
            ec2.createSecurityGroup(params, function(err, data) {
                if (err){
                    reject(err);
                }else{
                    resource.sg=data.GroupId;
                    setTags(resource.sg);
                    resolve(resource.sg);
                }
            });
        });
        
        //Attaches the internet gateway to the VPC
        var pattach= new Promise(function(resolve, reject){
            var params = {
              InternetGatewayId: resource.ig, /* required */
              VpcId: resource.vpc, /* required */
              DryRun: false
            };
            ec2.attachInternetGateway(params, function(err, data) {
              if (err) reject(err);
              else{
                resolve();
              }
            });
        });
        
        //Modifies the VPC
        var pmodify= new Promise(function(resolve, reject){
            var params = {
              EnableDnsHostnames: {
               Value: true
              }, 
              VpcId: resource.vpc
             };
             ec2.modifyVpcAttribute(params, function(err, data) {
               if (err) reject(err);
               else {    
                   params.EnableDnsSupport={
                       Value:true
                   };
                   delete params.EnableDnsHostnames;
                   ec2.modifyVpcAttribute(params, function(err, data) {
                       if (err) reject(err);
                       else {    
                           resolve();
                       }
                    });
               }
             });
        });
        
        Promise.all([prt,psg,pattach,pmodify]).then(function(allData){
            
            //Creates a subnet in avbailability zone a
            var psn1= new Promise(function(resolve, reject){
                var cidr2=subnets[0];
                var params = {
                  CidrBlock: cidr2,
                  VpcId: resource.vpc,
                  AvailabilityZone: region+'a'
                 };
                 console.log('Parameters declared');
                 ec2.createSubnet(params, function(err, data) {
                   if (err) {
                        reject(err);
                    }else{
                       resource.sn1=data.Subnet.SubnetId;
                       setTags(resource.sn1);
                       resolve(resource.sn1);
                   }
                }); 
            });
            
            //Creates a subnet in avalability zone b
            var psn2= new Promise(function(resolve, reject){
                var cidr2=subnets[1];
                var params = {
                  CidrBlock: cidr2,
                  VpcId: resource.vpc,
                  AvailabilityZone: region+'b'
                 };
                 console.log('Parameters declared');
                 ec2.createSubnet(params, function(err, data) {
                   if (err){
                        reject(err);
                    }else{
                       resource.sn2=data.Subnet.SubnetId;
                       setTags(resource.sn2);
                       resolve(resource.sn2);
                    }
                });
            });
            
            //Sets a basic security group rule
            var prule= new Promise(function(resolve, reject){
                var params = {
                  DryRun: false,
                  GroupId: resource.sg,
                  IpPermissions:[{
                    IpProtocol: '-1',
                      UserIdGroupPairs:[{
                        GroupId: resource.sg,
                         VpcId:resource.vpc
                          }]
                    }],
                };
                ec2.authorizeSecurityGroupIngress(params, function(err, data) {
                  if (err) reject();
                  else{
                        resolve();
                    }
                }); 
            });
            Promise.all([psn1,psn2, prule]).then(function(allData){
                var promises=[];
                for(var i=0;i===1;i++){
    	             promises[i]= new Promise(function(resolve,reject){
    					var params = {
                            RouteTableId: resource.rt, 
                            SubnetId: allData[i]
                        };
                        ec2.associateRouteTable(params, function(err, data) {
                        if (err) reject();
                        else resolve();
                        });
    				 });
    			}
    			
    			Promise.all([promises]).then(function(allData){
                    callback(null,[resource]);
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






