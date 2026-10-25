// Customer ko dikhne wale error messages: code mein Hinglish, customer ko English (default).
// Sirf jab customer ne Hinglish chuni ho (X-Lang: hinglish) tab original Hinglish. Admin panel hamesha Hinglish.
const EXACT = {
  'Is order ID se koi order nahi mila.': 'No order found with this order ID.',
  'Is order ID aur email se koi order nahi mila.': 'No order found with this order ID and email.',
  'Ye product ab available nahi hai.': 'This product is no longer available.',
  'Apna naam daalo.': 'Please enter your name.',
  'Sahi email daalo, order isi se track hoga.': 'Please enter a valid email — you will track your order with it.',
  'Sahi mobile number daalo (10 digit).': 'Please enter a valid mobile number.',
  'Manual UPI payment abhi band hai. Online pay karo.': 'UPI payment is turned off right now. Please pay online.',
  'Is order ka payment pehle hi submit ho chuka hai.': 'Payment for this order has already been submitted.',
  'UTR / Transaction ID 12 digit ka hota hai. Apne payment app ki history mein dekho.': 'The UTR / transaction ID has 12 digits. Check your payment app history.',
  'Ye UTR pehle hi kisi aur order mein use ho chuka hai.': 'This UTR has already been used for another order.',
  'OTP email nahi gaya. Thodi der baad try karo ya password se login karo.': 'Could not send the OTP email. Try again shortly or log in with your password.',
  'OTP login abhi band hai. Password se login karo.': 'OTP login is turned off. Please log in with your password.',
  'Sahi email daalo.': 'Please enter a valid email.',
  'Mobile number 10 digit ka hona chahiye.': 'Please enter a valid 10-digit mobile number.',
  'Password kam se kam 8 characters ka rakho.': 'Password must be at least 8 characters.',
  'Ye password bahut aasaan hai. Thoda strong rakho.': 'This password is too easy to guess. Please choose a stronger one.',
  'Is email se account pehle se hai. Login karo ya OTP se andar aao.': 'An account with this email already exists. Log in or use an OTP.',
  'Login nahi hai': 'You are not logged in.',
  'Email abhi set nahi hai. Support se contact karo.': 'Email is not available right now. Please contact support.',
  'Purana password galat hai.': 'Your current password is incorrect.',
  'Naya password kam se kam 8 characters ka ho.': 'New password must be at least 8 characters.',
  'OTP galat hai ya expire ho gaya.': 'The OTP is wrong or has expired.',
  'Ye coupon code valid nahi hai.': 'This coupon code is not valid.',
  'Ye coupon expire ho chuka hai.': 'This coupon has expired.',
  'Ye coupon ki limit poori ho chuki hai.': 'This coupon has reached its usage limit.',
  'Cart khaali hai.': 'Your cart is empty.',
  'Cart ka koi product ab available nahi hai. Page refresh karke dobara add karo.': 'An item in your cart is no longer available. Refresh the page and add it again.',
  'Apna referral code khud par nahi chalta — ise dosto ko bhejo.': 'You can’t use your own referral code — share it with friends instead.',
  'Ye coupon kisi aur email ke liye hai. Wahi email daalo jis par coupon aaya tha.': 'This coupon belongs to another email. Use the email the coupon was sent to.',
  'Ye coupon sirf pehle order ke liye hai.': 'This coupon is valid on first orders only.',
  'Coupon nahi ban paaya, dobara try karo.': 'Could not create your code. Please try again.',
  'Newsletter abhi band hai.': 'The newsletter is closed right now.',
  'Crypto payment abhi set nahi hai.': 'Crypto payment is not available right now.',
  'Payment server se connect nahi hua. 1 minute baad try karo.': 'Could not reach the payment server. Please try again in a minute.',
  'Crypto payment abhi band hai.': 'Crypto payment is turned off right now.',
  'Is order ka payment ho chuka hai.': 'This order is already paid.',
  'Is order ka USDT price nahi bana. Support se baat karo.': 'Could not calculate the USDT price for this order. Please contact support.',
  'Payment server ka jawab match nahi hua.': 'The payment server response did not match. Please try again.',
  'Login karo': 'Please log in.',
  'Session khatam. Dobara login karo.': 'Your session has ended. Please log in again.',
  'Pehle login karo.': 'Please log in first.',
  'Server mein dikkat aayi. Thodi der baad try karo.': 'Something went wrong on our side. Please try again shortly.',
  'Request bahut badi hai.': 'The request is too large.',
  'Bahut zyada requests. Thodi der baad try karo.': 'Too many requests. Please try again shortly.',
  'Bahut zyada OTP maange gaye. Ek ghante baad try karo.': 'Too many OTP requests. Please try again in an hour.',
  'Naya OTP 45 second baad maango.': 'Please wait 45 seconds before requesting a new OTP.',
  'Bahut galat try. Naya OTP maango.': 'Too many wrong attempts. Please request a new OTP.',
  'Bahut zyada orders. 15 minute baad try karo.': 'Too many orders. Please try again in 15 minutes.',
  'Bahut zyada coupon try. Ek minute ruko.': 'Too many coupon attempts. Please wait a minute.',
  'Bahut zyada try. Ek ghante baad.': 'Too many attempts. Please try again in an hour.',
  'Bahut zyada try. 15 minute baad dobara karo.': 'Too many attempts. Please try again in 15 minutes.',
};
const PATTERNS = [
  [/^Ye coupon (.+) ya usse zyada ke order par chalta hai\.$/, m => `This coupon needs a minimum order of ${m[1]}.`],
  [/^(.+) ke sirf (\d+) piece bache hain\.$/, m => `Only ${m[2]} left of ${m[1]}.`],
  [/^(.+) abhi out of stock hai\.$/, m => `${m[1]} is out of stock right now.`],
];
function toEnglish(msg) {
  if (EXACT[msg]) return EXACT[msg];
  for (const [re, f] of PATTERNS) { const m = String(msg).match(re); if (m) return f(m); }
  return msg;
}
// req ke hisaab se: admin + Hinglish customer → original, baaki → English
const forReq = (req, msg) => (/^\/api\/admin\b/.test(req.url || '') || req.headers['x-lang'] === 'hinglish' ? msg : toEnglish(msg));
module.exports = { toEnglish, forReq };
