
const pg=require('pg');

exports.handler = (event, context, callback) => {
	
    
    //Connect to the db
    var client = new pg.Client(event.conn);
    client.connect(function (err) {
		if (err){
			console.log(err);
			callback(err);
		}else{
			
			//Create promises
			var promises=[];
			for(var i=0;i<event.sql.length;i++){
	             promises[i]= new Promise(function(resolve,reject){
					var sql=event.sql[i];
					client.query(sql, function (err, result) {
						if (err) {
							reject(err);
						}else{
							resolve(result.rows);
						}
					});
				 });
			}
			
			//Promise all and callback results
    		Promise.all(promises).then(function(allResults){
	        	client.end();
    			callback(null,allResults);	
    		}).catch(function(error) {
	            callback(error);
	        });
		}
    });
};