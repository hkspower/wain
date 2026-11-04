// ROUND 3 OF THE ASSISTANT REVIEW (fixer, findings 1-12, 16, 17, 20-22) - the routing rows.
//
// One module, read by test:assistant (which puts every row through assistant_route in
// one PHP process and checks the intent and the topic) and by anyone iterating on the
// router by hand. Every message is quoted as the reviewer wrote it; the CONTROLS under
// each finding are the ordinary messages the new rule must leave alone, because a rule
// that fixes the quoted sentence and breaks a common one is the failure every earlier
// round had (see assistant-regression.mjs).
//
// Row: [message, want]. want is 'intent', 'intent/topic' ('-' = no topic, '*' = any topic)
// or either of those with a leading '!' (must NOT be that).
export const ROUND3 = [
  ['#1 MSA imperative and Arabizi cancel, with and without the order number', [
    ['ألغِ طلبي SP1KNETPAID01', 'cancel'], ['ألغ الطلب', 'cancel'], ['الغ طلبي', 'cancel'], ['ألغِ الطلب SP5SHIPPED005', 'cancel'],
    ['ilghi el order SP1KNETPAID01', 'cancel'], ['elghi el talab SP5SHIPPED005', 'cancel'], ['alghy el order', 'cancel'],
    ['alghee talabi', 'cancel'], ['ilghi talabi', 'cancel'], ['ma abi el talab', 'cancel'], ['mabi el talab', 'cancel'],
    ['ma abi el order', 'cancel'], ['abi algi el order', 'cancel'], ['abgha alghi el order', 'cancel'],
    // controls: the opposite wish, a question about the policy, and the ordinary look-up
    ['لا تلغون طلبي', '!cancel'], ["don't cancel my order", '!cancel'], ['where is my order SP1KNETPAID01', 'order_status'],
    ['what is your cancellation policy', 'returns/cancel'],
  ]],
  ['#2 «كنسل» as a state or as the shop\'s act is a status question, as a request it is a cancel', [
    ['ليش انكنسل طلبي SP7CANCELCOD7', 'order_status'], ['كنسلتوا طلبي ليش', 'order_status'], ['طلبي انكنسل', 'order_status'],
    ['تم كنسل الطلب', 'order_status'], ['كنسلتوا طلبي ابيه', 'order_status'],
    ['كنسل طلبي', 'cancel'], ['ابي اكنسل طلبي', 'cancel'], ['كنسلوا الطلب', 'cancel'], ['كنسل الطلب SP7CANCELCOD7', 'cancel'],
  ]],
  ['#3 money that moved, and charges the customer did not make, reach a person', [
    ['شفت خصم من بنكي من سبورتا', 'contact/money'], ['خصم من بنكي', 'contact/money'], ['نزل من كرتي', 'contact/money'],
    ['خصم من الكرت', 'contact/money'], ['حصلت عملية دفع ما سويتها', 'contact/money'], ['عملية شراء ما سويتها', 'contact/money'],
    ['ما طلبت شي منكم', 'contact/money'], ['someone ordered using my card', 'contact/money'],
    ['I did not authorize this payment', 'contact/money'], ['they took KD 14 from my card', 'contact/money'],
    ['I never ordered from you', 'contact/money'], ["I didn't authorise this order", 'contact/money'],
    ['you pulled 14 KD from my account', 'contact/money'],
    // controls
    ['في خصم؟', 'recommend'], ['do you have a discount', 'recommend'], ['can I pay with my card', 'payment'],
    ['هل في خصم على الجاكيت', 'recommend'], ['خصم الطلاب', 'recommend'],
  ]],
  ['#4 a generic problem with paying is a checkout problem for a person', [
    ['I have a problem with my payment', 'contact/checkout_problem'], ['payment issue', 'contact/checkout_problem'],
    ['something is wrong with my payment', 'contact/checkout_problem'], ['payment failure', 'contact/checkout_problem'],
    ['payment unsuccessful', 'contact/checkout_problem'], ["your site doesn't accept my card", 'contact/checkout_problem'],
    ['عندي مشكلة بالدفع', 'contact/checkout_problem'], ['مشكلة في الدفع', 'contact/checkout_problem'],
    ['الدفع ما زبط', 'contact/checkout_problem'], ['الدفع ما راح', 'contact/checkout_problem'],
    ['حاولت ادفع كم مرة ما مشت', 'contact/checkout_problem'],
    // controls
    ['how do I pay', 'payment'], ['what payment methods do you accept', 'payment'], ['what if my payment fails', 'payment'],
    ['ما راح ادفع كاش', 'payment'], ['is there a problem if I pay cash', '!contact/checkout_problem'],
  ]],
  ['#5 a question about money, or a negation, is not a PAYMENT PROBLEM', [
    ['كم المبلغ الكلي', 'payment'], ['كم المبلغ الاجمالي للطلب', 'payment'], ['شكثر المبلغ', 'payment'],
    ['do you accept bank transfer', 'payment'], ['تحويل بنكي', 'payment'], ['which bank do you use', 'payment'],
    ["I don't want to be charged twice", 'payment'], ['will it be charged twice if I order two', 'payment'],
    ['I have not paid', 'payment'], ['not paid yet', 'payment'], ["I haven't paid yet", 'payment'],
    ["I wasn't charged", '!contact'], ["I haven't been charged yet", '!contact'], ['is it worth the money', '!contact'],
    // controls: the real complaints are still complaints
    ['I was charged twice', 'contact/money'], ['انخصم المبلغ مرتين', 'contact/money'], ['فلوسي وين راحت بعد الطلب', 'contact'],
    ['my card was charged but the order failed', 'contact/money'],
  ]],
  ['#6 «يوصلني … الأحد» is a delivery question, not a request for a person', [
    ['متى يوصلني الطلب يوم الأحد', 'delivery'], ['هل يوصلني الطلب يوم الاحد', 'delivery'], ['ابي الطلب يوصلني الاحد', 'delivery'],
    ['هل يوصل الطلب يوم الأحد', 'delivery'], ['وصلني الطلب وفيه قطعة واحدة بس', 'contact/complaint'],
    ['وصلني جاكيت واحد', '!contact/-'],
    // controls
    ['ابي اكلم موظف', 'contact'], ['ابي اكلم احد', 'contact'], ['في احد يرد؟', 'contact'], ['وصلني بالمدير', 'contact'],
    ['ابي اتكلم مع شخص', 'contact'],
  ]],
  ['#7 a request for a person or a call, worded outside the old lists', [
    ['أريد التحدث إلى المدير', 'contact'], ['أريد التحدث مع شخص', 'contact'], ['أود التحدث مع احد', 'contact'],
    ['ابي اتحدث مع احد', 'contact'], ['ممكن اتحدث مع المدير', 'contact'], ['ما هو رقم هاتفكم', 'contact'],
    ['بريدكم الالكتروني', 'contact'], ['اريد مراسلتكم', 'contact'], ['رقم المدير', 'contact'],
    ['give me a call', 'contact'], ['ring me', 'contact'], ['my number is 99998888 please call', 'contact'],
    // controls
    ['do you have a phone strap', 'search'], ['what is the best ring for running', '!contact'],
  ]],
  ['#8 a greeting does not swallow a problem, and an introduction is not a product search', [
    ['hi, I have a problem', 'contact'], ['hello, there is an issue', 'contact'], ['هلا عندي مشكلة', 'contact'],
    ['السلام عليكم عندي مشكلة', 'contact'], ['السلام عليكم فيه مشكلة', 'contact'], ['مرحبا مشكلة', 'contact'],
    ['hello', 'greeting'], ['السلام عليكم', 'greeting'], ['hello my name is Ahmed', 'greeting'], ['hi, first time here', 'greeting'],
    ['hi I found you on instagram', 'greeting'], ['hello I am a returning customer', 'greeting'],
    ['السلام عليكم انا احمد', 'greeting'], ['هلا شفتكم بالانستقرام', 'greeting'], ['مرحبا اول مرة اطلب منكم', 'greeting'],
    ['هلا ابو محمد', 'greeting'], ['مساء النور وياكم', 'greeting'],
  ]],
  ['#9 good news about an order, and an angry or sad emoji', [
    ['my order arrived thank you so much', 'thanks'], ['the order arrived, thanks!', 'thanks'],
    ['the parcel arrived and everything is perfect', 'thanks'], ['استلمت طلبي وهو ممتاز', 'thanks'],
    ['my order arrived, thanks', 'thanks'], ['وصلني الطلب شكرا', 'thanks'],
    ['😡', 'contact'], ['👎', 'contact'], ['😢', 'contact'], ['🤬', 'contact'],
    ['👍', 'thanks/ack'], ['🙏', 'thanks'], ['😊', 'thanks'],
    // controls: arrived AND something wrong, or only a question
    ['my order arrived but the jacket is damaged', 'contact/complaint'], ['has my order arrived? thanks', 'order_status'],
    ['my order arrived but it is the wrong size, thanks', '!thanks'],
  ]],
  ['#10 a late order with a money wish, a cancelled order that came, a refund that took too long', [
    ['my order is late and I want my money back', 'contact/not_received'], ['my order is delayed, I want a refund', 'contact/not_received'],
    ['I cancelled my order but the courier came', 'contact'], ['I cancelled my order but they sent it anyway', 'contact'],
    ['I cancelled but money is not back', 'contact/refund'], ['refund took too long', 'contact/refund'],
    ['the refund is taking too long', 'contact/refund'],
    // controls: the policy question and the ordinary look-up keep their answers
    ['can I get a refund if my order is late', '!contact/not_received'], ['how long does a refund take', 'returns'],
    ['I want my money back', 'returns'],
  ]],
  ['#11 a sizes or stock question that names a garment is searched; the guide is for fit', [
    ['what sizes are in stock for the define jacket', 'search'], ['sculpt jacket sizes available', 'search'],
    ['what sizes do the leggings come in', 'search'], ['ابي الاسود بمقاس M', 'search'],
    ['هل يتوفر الجاكيت بمقاس كبير', 'search'], ['متى ينزل المقاس XL', 'contact/restock'],
    // controls
    ['what size should I get for the jacket', 'sizes'], ['size chart', 'sizes'], ['what sizes do you have', 'sizes'],
    ['how does the jacket fit', 'sizes'], ['شنو المقاسات', 'sizes'], ['XL?', 'sizes'], ['the black one in medium please', 'search'],
  ]],
  ['#16 a standalone bye closes the chat; a topic with «بأي» or "bye" inside it keeps its topic', [
    ['بأي طريقة يمكنني الدفع؟', 'payment'], ['بأي مقاس تنصحني؟', 'sizes'], ['بأي طريقة اتتبع طلبي؟', 'order_status'],
    ['بأي طريقة اقدر ارجع القطعة؟', 'returns'], ['بأي وقت يصل الطلب؟', 'delivery'],
    ['talk to you later, my order is late', '!thanks/bye'], ['will get back to you, my order did not arrive', '!thanks/bye'],
    ['goodbye, one more thing: can I return the jacket', 'returns'],
    // controls: the real goodbyes
    ['باي', 'thanks/bye'], ['bye', 'thanks/bye'], ['bye bye', 'thanks/bye'], ['thanks bye', 'thanks/bye'],
    ['مع السلامة', 'thanks/bye'], ['شكرا باي', 'thanks/bye'], ['ok thanks, talk to you later', 'thanks/bye'],
    ['I will get back to you', 'thanks/bye'], ['ارجع لكم بعدين', 'thanks/bye'], ['see you', 'thanks/bye'],
    ['goodbye', 'thanks/bye'], ['talk later', 'thanks/bye'],
  ]],
  ['#17 a cancel worded without the cancel verb', [
    ["I don't want to continue with order SPT2PAIDPACK02", 'cancel'], ['forget order SPT2PAIDPACK02', 'cancel'],
    ['I refuse order SPT2PAIDPACK02', 'cancel'], ['no longer interested in order SPT2PAIDPACK02', 'cancel'],
    ['never mind order SPT2PAIDPACK02', 'cancel'], ['I no longer wish to proceed with SPT2PAIDPACK02', 'cancel'],
    ["I don't want to continue with my order", 'cancel'], ['I refuse the order', 'cancel'],
    ['I no longer wish to proceed with the order', 'cancel'], ['the order is not needed anymore', 'cancel'],
    ["don't bring the order", 'cancel'], ["I made a mistake, I don't want the items", 'cancel'],
    // controls
    ['never mind, where is my order', 'order_status'], ['forget it', '!cancel'], ["I don't want to wait for my order SPT2PAIDPACK02", '!cancel'],
    ['I received the order and I do not want it', 'returns'],
  ]],
  ['#20 a discount that did not apply is a coupon problem even without the word code', [
    ['the discount did not apply', 'contact/coupon_problem'], ['discount not working', 'contact/coupon_problem'],
    ["my 10% discount didn't apply at checkout", 'contact/coupon_problem'], ['the promo did not work', 'contact/coupon_problem'],
    ["I didn't get the discount", 'contact/coupon_problem'], ['الخصم ما اشتغل', 'contact/coupon_problem'],
    ['ما نزل الخصم', 'contact/coupon_problem'], ['الخصم ما انحسب', 'contact/coupon_problem'],
    ['العرض ما اشتغل', 'contact/coupon_problem'],
    // controls: a question about offers is still a shelf
    ['what discounts do you have', 'recommend'], ['is there any offer', 'recommend'], ['do you have a promo', 'recommend'],
    ['does the discount apply to sale items', 'recommend'], ['في خصم؟', 'recommend'],
  ]],
  ['#21 an unrecognised or doubled charge, said without the listed words', [
    ['there is an unknown transaction from Sporta on my card', 'contact/money'], ['فيه عملية مشبوهة على بطاقتي', 'contact/money'],
    ['فيه خصمين على بطاقتي', 'contact/money'], ["I don't recognise this charge", 'contact/money'],
    ['العملية هذي مو مني', 'contact/money'], ['suspicious charge on my statement', 'contact/money'],
    // controls
    ['unknown size', '!contact/money'], ['I do not recognise this jacket in the photo', '!contact/money'],
  ]],
  ['#22 postponing, rescheduling or redirecting a delivery is a change, not a cancel', [
    ['please postpone the delivery', 'contact/order_change'], ['deliver after Eid', 'contact/order_change'],
    ['I will be traveling, please deliver later', 'contact/order_change'], ['ابي تأجيل التوصيل', 'contact/order_change'],
    ['اجلوا التوصيل لين يوم الاحد', 'contact/order_change'],
    ['stop delivery to Hawally, send it to Salmiya', 'contact/order_change'],
    ['cancel the delivery tomorrow, deliver on Sunday', 'contact/order_change'],
    // controls
    ['can you deliver on Friday', 'delivery'], ['when will you deliver', 'delivery'], ['stop my order', 'cancel'],
    ['please cancel my order', 'cancel'],
  ]],
]
