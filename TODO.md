1 - Collect the data and dump to a database or bunch of json files
2 - Optimize by only fetching what is necessary, only fetch giveaways that have a end_timestamp of maximum 1 week from new Date()
3 - Cron job that executes this and pushes to a public gist