import app from "./app.js";
import { caseSyncCronJob } from "./cron/caseSyncCron.js";
import cron from "node-cron";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`NCLT API running on port ${PORT}`);
});

//Schedule the job to run at 12 AM each day
cron.schedule('0 0 * * *', async () => {
  console.log('Starting case sync cron job at', new Date());
  try {
    await caseSyncCronJob();
    console.log('Case sync cron job completed at', new Date());
  } catch (err) {
    console.error('Error in case sync cron job:', err);
  }
}, {
  timezone: "Asia/Kolkata"
});

//Schedule the job to run at 8 AM each day
/*cron.schedule('0 8 * * *', async () => {
  console.log('Starting due notifications job at', new Date());
  try {
    await sendDueNotifications();
    console.log('Due notifications job completed at', new Date());
  } catch (err) {
    console.error('Error in due notifications job:', err);
  }
}, {
  timezone: "Asia/Kolkata"
});*/