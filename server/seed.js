'use strict';
const bcrypt = require('bcryptjs');

const WILAYAS = [
  [1, 'أدرار', 'Adrar'], [2, 'الشلف', 'Chlef'], [3, 'الأغواط', 'Laghouat'],
  [4, 'أم البواقي', 'Oum El Bouaghi'], [5, 'باتنة', 'Batna'], [6, 'بجاية', 'Béjaïa'],
  [7, 'بسكرة', 'Biskra'], [8, 'بشار', 'Béchar'], [9, 'البليدة', 'Blida'],
  [10, 'البويرة', 'Bouira'], [11, 'تمنراست', 'Tamanrasset'], [12, 'تبسة', 'Tébessa'],
  [13, 'تلمسان', 'Tlemcen'], [14, 'تيارت', 'Tiaret'], [15, 'تيزي وزو', 'Tizi Ouzou'],
  [16, 'الجزائر', 'Alger'], [17, 'الجلفة', 'Djelfa'], [18, 'جيجل', 'Jijel'],
  [19, 'سطيف', 'Sétif'], [20, 'سعيدة', 'Saïda'], [21, 'سكيكدة', 'Skikda'],
  [22, 'سيدي بلعباس', 'Sidi Bel Abbès'], [23, 'عنابة', 'Annaba'], [24, 'قالمة', 'Guelma'],
  [25, 'قسنطينة', 'Constantine'], [26, 'المدية', 'Médéa'], [27, 'مستغانم', 'Mostaganem'],
  [28, 'المسيلة', "M'Sila"], [29, 'معسكر', 'Mascara'], [30, 'ورقلة', 'Ouargla'],
  [31, 'وهران', 'Oran'], [32, 'البيض', 'El Bayadh'], [33, 'إليزي', 'Illizi'],
  [34, 'برج بوعريريج', 'Bordj Bou Arréridj'], [35, 'بومرداس', 'Boumerdès'],
  [36, 'الطارف', 'El Tarf'], [37, 'تندوف', 'Tindouf'], [38, 'تيسمسيلت', 'Tissemsilt'],
  [39, 'الوادي', 'El Oued'], [40, 'خنشلة', 'Khenchela'], [41, 'سوق أهراس', 'Souk Ahras'],
  [42, 'تيبازة', 'Tipaza'], [43, 'ميلة', 'Mila'], [44, 'عين الدفلى', 'Aïn Defla'],
  [45, 'النعامة', 'Naâma'], [46, 'عين تموشنت', 'Aïn Témouchent'], [47, 'غرداية', 'Ghardaïa'],
  [48, 'غليزان', 'Relizane'], [49, 'تيميمون', 'Timimoun'], [50, 'برج باجي مختار', 'Bordj Badji Mokhtar'],
  [51, 'أولاد جلال', 'Ouled Djellal'], [52, 'بني عباس', 'Béni Abbès'], [53, 'عين صالح', 'In Salah'],
  [54, 'عين قزام', 'In Guezzam'], [55, 'تقرت', 'Touggourt'], [56, 'جانت', 'Djanet'],
  [57, 'المغير', "El M'Ghair"], [58, 'المنيعة', 'El Meniaa'],
];

const PERMISSIONS = [
  ['dashboard.view', 'dashboard', 'عرض لوحة التحكم', 'Voir le tableau de bord'],
  ['bookings.view', 'bookings', 'عرض الحجوزات', 'Voir les rendez-vous'],
  ['bookings.edit', 'bookings', 'تعديل الحجوزات', 'Modifier les rendez-vous'],
  ['bookings.assign', 'bookings', 'تعيين الموظفين والمراكز للحجوزات', 'Affecter les rendez-vous'],
  ['bookings.export', 'bookings', 'تصدير الحجوزات', 'Exporter les rendez-vous'],
  ['customers.view', 'customers', 'عرض الزبائن', 'Voir les clients'],
  ['customers.edit', 'customers', 'تعديل بيانات الزبائن', 'Modifier les clients'],
  ['contact_messages.view', 'messages', 'عرض رسائل التواصل', 'Voir les messages de contact'],
  ['contact_messages.edit', 'messages', 'معالجة رسائل التواصل', 'Traiter les messages de contact'],
  ['internal.use', 'messaging', 'استخدام المراسلات الداخلية', 'Utiliser la messagerie interne'],
  ['centers.view', 'centers', 'عرض المراكز', 'Voir les centres'],
  ['centers.manage', 'centers', 'إدارة المراكز', 'Gérer les centres'],
  ['wilayas.view', 'wilayas', 'عرض الولايات', 'Voir les wilayas'],
  ['wilayas.manage', 'wilayas', 'إدارة الولايات', 'Gérer les wilayas'],
  ['users.view', 'users', 'عرض المستخدمين', 'Voir les utilisateurs'],
  ['users.manage', 'users', 'إدارة المستخدمين والأدوار', 'Gérer les utilisateurs et rôles'],
  ['content.view', 'content', 'عرض محتوى الموقع', 'Voir le contenu du site'],
  ['content.manage', 'content', 'تعديل محتوى الموقع', 'Modifier le contenu du site'],
  ['content.publish', 'content', 'نشر محتوى الموقع', 'Publier le contenu du site'],
  ['settings.view', 'settings', 'عرض الإعدادات', 'Voir les paramètres'],
  ['settings.manage', 'settings', 'إدارة الإعدادات', 'Gérer les paramètres'],
  ['audit.view', 'audit', 'عرض سجل التدقيق', 'Voir le journal d’audit'],
  ['backup.run', 'backup', 'إنشاء نسخة احتياطية', 'Créer une sauvegarde'],
];

const ALL_PERMS = PERMISSIONS.map((p) => p[0]);

const ROLES = [
  {
    key: 'super_admin', all_centers: true, is_system: true,
    name_ar: 'المدير الأعلى', name_fr: 'Super administrateur',
    description_ar: 'تحكم كامل في المنصة والمراكز والموظفين والصلاحيات والإعدادات وسجل التدقيق ومحتوى الموقع.',
    description_fr: 'Contrôle total de la plateforme, des centres, des employés, des permissions, des paramètres, du journal d’audit et du contenu.',
    perms: ALL_PERMS,
  },
  {
    key: 'network_manager', all_centers: true, is_system: true,
    name_ar: 'مدير الشبكة', name_fr: 'Responsable du réseau',
    description_ar: 'كل المراكز، إحصائيات عامة، عمليات مسموحة، وأداء المراكز.',
    description_fr: 'Tous les centres, statistiques globales, opérations autorisées et performance des centres.',
    perms: ['dashboard.view', 'bookings.view', 'bookings.edit', 'bookings.assign', 'bookings.export',
      'customers.view', 'customers.edit', 'contact_messages.view', 'contact_messages.edit',
      'internal.use', 'centers.view', 'centers.manage', 'wilayas.view', 'wilayas.manage',
      'users.view', 'content.view', 'audit.view', 'settings.view'],
  },
  {
    key: 'center_manager', all_centers: false, is_system: true,
    name_ar: 'مدير المركز', name_fr: 'Responsable de centre',
    description_ar: 'مركزه فقط وموظفوه وحجوزاته وبياناته.',
    description_fr: 'Son centre uniquement : équipe, rendez-vous et données.',
    perms: ['dashboard.view', 'bookings.view', 'bookings.edit', 'bookings.assign', 'bookings.export',
      'customers.view', 'customers.edit', 'contact_messages.view', 'contact_messages.edit',
      'internal.use', 'centers.view', 'wilayas.view', 'users.view', 'content.view'],
  },
  {
    key: 'receptionist', all_centers: false, is_system: true,
    name_ar: 'موظف الاستقبال', name_fr: 'Réceptionniste',
    description_ar: 'الحجوزات، التواصل، تحديث الحالات، والبيانات اللازمة للعمل.',
    description_fr: 'Rendez-vous, contact, mise à jour des statuts et données nécessaires au travail.',
    perms: ['dashboard.view', 'bookings.view', 'bookings.edit', 'bookings.assign',
      'customers.view', 'customers.edit', 'contact_messages.view', 'contact_messages.edit',
      'internal.use', 'centers.view', 'wilayas.view'],
  },
  {
    key: 'audiologist', all_centers: false, is_system: true,
    name_ar: 'أخصائي السمع', name_fr: 'Audioprothésiste',
    description_ar: 'المواعيد المحالة، المعلومات الضرورية، وملاحظات مهنية ضمن الصلاحيات.',
    description_fr: 'Rendez-vous orientés, informations nécessaires et notes professionnelles autorisées.',
    perms: ['dashboard.view', 'bookings.view', 'bookings.edit', 'customers.view', 'internal.use', 'centers.view'],
  },
  {
    key: 'content_manager', all_centers: true, is_system: true,
    name_ar: 'مسؤول المحتوى', name_fr: 'Responsable de contenu',
    description_ar: 'صفحات الموقع، الخدمات والأسئلة، والمحتوى، دون الحسابات أو البيانات الحساسة.',
    description_fr: 'Pages du site, services, FAQ et contenu, sans comptes ni données sensibles.',
    perms: ['dashboard.view', 'content.view', 'content.manage', 'content.publish', 'centers.view', 'wilayas.view'],
  },
];

const SERVICES = [
  ['hearing-assessment', 'الفحص الشامل للسمع', 'Bilan auditif complet',
    'تقييم القدرة السمعية وتحديد طبيعة الاحتياج.', "Évaluation de l’audition et identification du besoin.", 30, 45, 'assessment', 1],
  ['hearing-aids', 'تركيب وضبط أجهزة السمع', 'Adaptation et réglage des appareils auditifs',
    'اختيار الجهاز المناسب وضبطه.', "Choix de l’appareil adapté et réglage.", 45, 60, 'hearing-aid', 2],
  ['children', 'فحوصات سمع الأطفال', "Bilan auditif de l’enfant",
    'فحوصات سمع الأطفال حسب العمر والحالة.', "Bilans adaptés à l’âge et à la situation de l’enfant.", 40, 60, 'child', 3],
  ['tinnitus', 'متابعة طنين الأذن', 'Suivi des acouphènes',
    'تقييم الشكوى السمعية ومتابعتها.', "Évaluation et suivi de la plainte auditive.", 30, 45, 'tinnitus', 4],
  ['ear-care', 'العناية بالأذن', "Soins de l’oreille",
    'العناية بالأذن ضمن اختصاص المركز.', "Soins de l’oreille dans le cadre des compétences du centre.", 20, 30, 'ear', 5],
  ['home-visits', 'المتابعة المنزلية', 'Suivi à domicile',
    'المتابعة المنزلية عند توفرها في المنطقة.', "Suivi à domicile lorsque disponible dans la région.", 45, 60, 'home', 6],
];

const FAQS = [
  ['كيف أحجز موعدًا؟', 'Comment prendre rendez-vous ?',
    'اضغط على زر «احجز موعد» واملأ النموذج. يصل الطلب إلى فريقنا، ثم يتصل بك موظف لتأكيد التاريخ والوقت. طلب الموعد وحده لا يعني أنه مؤكد.',
    'Cliquez sur « Prendre rendez-vous » et remplissez le formulaire. Votre demande parvient à notre équipe, puis un collaborateur vous appelle pour confirmer la date et l’heure. Une demande n’est pas une confirmation.'],
  ['هل الفحص الأول مجاني؟', 'Le premier bilan est-il gratuit ?',
    'الفحص السمعي الأولي مجاني حسب ما هو معتمد في شبكة المراكز. يؤكد لك الفريق عند الاتصال إن كان العرض ساريًا في المركز الذي اخترته.',
    'Le bilan auditif initial est gratuit selon les conditions appliquées dans le réseau. L’équipe vous confirme par téléphone si l’offre est valable dans le centre choisi.'],
  ['كيف أجد أقرب مركز؟', 'Comment trouver le centre le plus proche ?',
    'استخدم قسم «مراكزنا» وابحث حسب الولاية أو المدينة، ثم اتصل بالمركز أو اطلب موعدًا مباشرة.',
    'Utilisez la section « Nos centres », recherchez par wilaya ou par ville, puis appelez le centre ou demandez un rendez-vous.'],
  ['هل تجرون فحوصات سمع للأطفال؟', 'Proposez-vous des bilans auditifs pour enfants ?',
    'نعم، حسب العمر والحالة. يحدد الفريق نوع الفحص المناسب بعد التواصل معكم وقبل الموعد.',
    'Oui, selon l’âge et la situation. L’équipe détermine le type de bilan adapté après votre prise de contact.'],
  ['هل تساعدون في إجراءات التعويض؟', 'Aidez-vous pour les démarches de remboursement ?',
    'يمكن لفريقنا شرح إجراءات الاستفادة والتعويض عند توفر الشروط. لا يمكن ضمان القبول مسبقًا، والقرار يعود للجهة المعنية.',
    'Notre équipe peut expliquer les démarches lorsque les conditions sont remplies. L’acceptation ne peut pas être garantie à l’avance ; la décision appartient à l’organisme concerné.'],
  ['كيف أتواصل مع الفريق؟', 'Comment contacter l’équipe ?',
    'عبر أرقام الهاتف المعلنة في الموقع أو نموذج التواصل. تُحفظ رسالتك في نظامنا ويتابعها الفريق المختص.',
    'Par les numéros affichés sur le site ou le formulaire de contact. Votre message est enregistré et suivi par l’équipe concernée.'],
];

const CONTENT = [
  // section, key, type, ar, fr
  ['branding', 'site_logo', 'image', '', ''],
  ['hero', 'hero_title', 'text', 'اسمع الحياة بوضوح.', 'Entendez la vie clairement.'],
  ['hero', 'hero_description', 'textarea',
    'نرافقك نحو سمع أفضل من خلال فحوصات سمع متخصصة وحلول سمعية مناسبة لاحتياجاتك.',
    'Nous vous accompagnons vers une meilleure audition grâce à des bilans auditifs spécialisés et des solutions adaptées à vos besoins.'],
  ['hero', 'hero_image', 'image', '/assets/hero-audiologist.svg', '/assets/hero-audiologist.svg'],
  ['hero', 'hero_image_2', 'image', '', ''],
  ['hero', 'hero_image_3', 'image', '', ''],
  ['intro', 'intro_title', 'text', 'خبرة واهتمام من أجل سمع أفضل', 'Expertise et attention pour une meilleure audition'],
  ['intro', 'intro_text', 'textarea',
    'AUDIOLEF شبكة متخصصة في فحوصات السمع وحلول السمع في الجزائر. يرافقك فريق مختص في كل مرحلة: الفحص الأولي، اختيار الحل المناسب، الضبط، ثم المتابعة. نشرح لك كل خطوة بوضوح، ونوجّهك إلى الخدمة والمركز الأنسب لحالتك.',
    'AUDIOLEF est un réseau spécialisé dans les bilans auditifs et les solutions auditives en Algérie. Une équipe dédiée vous accompagne à chaque étape : bilan initial, choix de la solution, réglage puis suivi. Chaque étape vous est expliquée clairement.'],
  ['intro', 'brands_title', 'text', 'علاماتنا التجارية', 'Nos marques'],
  ['intro', 'brands_intro', 'textarea',
    'نعمل مع علامات سمعية معروفة مثل Hansaton (من مجموعة Sonova) وAudifon. تُعرض أسماء العلامات للتعريف بالحلول المتوفرة، ولا تعني شراكة رسمية إلا عند وجود اتفاق مؤكد.',
    'Nous travaillons avec des marques auditives reconnues telles que Hansaton (groupe Sonova) et Audifon. Les noms sont présentés à titre informatif et n’impliquent aucun partenariat officiel sans accord confirmé.'],
  ['how', 'how_title', 'text', 'كيف نعمل', 'Comment ça marche'],
  ['how', 'how_intro', 'text', 'أربع خطوات واضحة من أول تواصل إلى المتابعة.', 'Quatre étapes claires, du premier contact au suivi.'],
  ['how', 'step1_title', 'text', 'اطلب فحص السمع الأولي المجاني', 'Demandez le bilan auditif initial gratuit'],
  ['how', 'step1_text', 'textarea', 'املأ نموذج طلب الموعد على الموقع، وسيتواصل معك الفريق لتأكيد الموعد.',
    'Remplissez le formulaire de demande de rendez-vous ; l’équipe vous contacte pour confirmer.'],
  ['how', 'step2_title', 'text', 'يتواصل الفريق لتوجيهك لأقرب مركز', 'L’équipe vous oriente vers le centre le plus proche'],
  ['how', 'step2_text', 'textarea', 'نتحقق من الولاية والمدينة والخدمة المطلوبة، ونقترح المركز الأنسب المتوفر.',
    'Nous vérifions la wilaya, la ville et le service demandé, puis proposons le centre disponible le plus adapté.'],
  ['how', 'step3_title', 'text', 'المختص يقيّم السمع', 'Le spécialiste évalue l’audition'],
  ['how', 'step3_text', 'textarea', 'يُجرى الفحص حسب العمر والحالة، ويُشرح لك ما تم تقييمه بوضوح.',
    'Le bilan est réalisé selon l’âge et la situation, et les résultats vous sont expliqués clairement.'],
  ['how', 'step4_title', 'text', 'شرح الحلول والمرافقة', 'Explication des solutions et accompagnement'],
  ['how', 'step4_text', 'textarea', 'نشرح الحلول المناسبة ونرافقك في إجراءات الاستفادة والتعويض عند توفر الشروط.',
    'Nous expliquons les solutions adaptées et vous accompagnons dans les démarches lorsque les conditions sont remplies.'],
  ['how', 'booking_note', 'textarea', 'طلب الموعد لا يعني تأكيده؛ يتصل بك فريقنا لتأكيد التاريخ والوقت.',
    'Une demande de rendez-vous n’est pas une confirmation : notre équipe vous appelle pour confirmer la date et l’heure.'],
  ['audiogram', 'audiogram_title', 'text', 'مثال توضيحي لتخطيط السمع', 'Exemple illustratif d’audiogramme'],
  ['audiogram', 'audiogram_note', 'textarea', 'مثال توضيحي فقط – ليس نتيجة فحص لمريض حقيقي.',
    'Exemple illustratif uniquement — il ne s’agit pas du résultat d’un patient réel.'],
  ['centers', 'centers_title', 'text', 'شبكة مراكزنا', 'Notre réseau de centres'],
  ['centers', 'centers_intro', 'textarea', 'ابحث حسب الولاية أو المدينة، واطلع على الخدمات المتوفرة وأوقات العمل، ثم اتصل أو اطلب موعدًا.',
    'Recherchez par wilaya ou par ville, consultez les services disponibles et les horaires, puis appelez ou demandez un rendez-vous.'],
  ['map', 'map_title', 'text', 'خريطة تغطيتنا', 'Notre couverture'],
  ['map', 'map_intro', 'textarea',
    'ولايات ومراكز مسجّلة في شبكة AUDIOLEF. تُحدَّث الخريطة تلقائيًا عند إضافة مركز جديد من لوحة الإدارة.',
    'Wilayas et centres enregistrés dans le réseau AUDIOLEF. La carte se met à jour automatiquement à chaque nouveau centre.'],
  ['map', 'map_note', 'text',
    'اضغط على ولاية للاطلاع على مراكزها.',
    'Cliquez sur une wilaya pour voir ses centres.'],
  ['faq', 'faq_title', 'text', 'الأسئلة الشائعة', 'Questions fréquentes'],
  ['faq', 'faq_intro', 'text', 'أجوبة مباشرة عن الأسئلة الأكثر تكرارًا.', 'Des réponses directes aux questions les plus fréquentes.'],
  ['contact', 'contact_title', 'text', 'تواصل معنا', 'Contactez-nous'],
  ['contact', 'contact_intro', 'textarea', 'اكتب رسالتك وسيتابعها الفريق المختص. يمكنك أيضًا الاتصال بنا مباشرة.',
    'Écrivez-nous : le message sera suivi par l’équipe concernée. Vous pouvez aussi nous appeler directement.'],
  ['contact', 'phone_primary', 'text', '+213560470019', '+213560470019'],
  ['contact', 'phone_secondary', 'text', '+213560470016', '+213560470016'],
  ['contact', 'phone_tertiary', 'text', '+213560470015', '+213560470015'],
  ['contact', 'contact_email', 'text', '', ''],
  ['contact', 'social_facebook', 'text', '', ''],
  ['contact', 'social_instagram', 'text', '', ''],
  ['contact', 'social_linkedin', 'text', '', ''],
  ['footer', 'footer_about', 'textarea',
    'AUDIOLEF منصة جزائرية متخصصة في خدمات السمع: فحوصات، أجهزة سمع، ومتابعة، ضمن شبكة مراكز.',
    'AUDIOLEF est une plateforme algérienne spécialisée dans les services auditifs : bilans, appareils et suivi, au sein d’un réseau de centres.'],
  ['footer', 'copyright', 'text', '© AUDIOLEF — جميع الحقوق محفوظة.', '© AUDIOLEF — Tous droits réservés.'],
  ['legal', 'privacy_policy', 'textarea',
    'سياسة الخصوصية\n\nنجمع فقط البيانات الضرورية لمعالجة طلبات المواعيد والرسائل: الاسم، الهاتف، الولاية والمدينة، والبريد عند إدخاله اختياريًا. تُستخدم هذه البيانات لتنظيم المواعيد والتواصل معك وتقديم الخدمة.\n\nلا تُنشر بياناتك علنًا، ولا تُباع لأطراف ثالثة. الوصول إليها محدود للموظفين المخوّلين وفق أدوارهم ومراكزهم، وتُسجّل العمليات الإدارية الحساسة في سجل التدقيق.\n\nيمكنك طلب الاطلاع على بياناتك أو تصحيحها أو حذفها بالتواصل معنا عبر الأرقام المعلنة.\n\nلا تُدرج معلومات طبية حساسة في نماذج الموقع؛ تُناقش الحالة مع المختص أثناء الزيارة.',
    'Politique de confidentialité\n\nNous collectons uniquement les données nécessaires au traitement des demandes de rendez-vous et des messages : nom, téléphone, wilaya, ville et e-mail si vous choisissez de le fournir. Ces données servent à organiser les rendez-vous, à vous contacter et à fournir le service.\n\nVos données ne sont ni publiées ni vendues. Leur accès est limité aux collaborateurs autorisés selon leur rôle et leur centre, et les opérations sensibles sont journalisées.\n\nVous pouvez demander l’accès, la rectification ou la suppression de vos données via les numéros affichés.\n\nN’inscrivez pas d’informations médicales sensibles dans les formulaires du site ; elles sont discutées avec le spécialiste lors de la visite.'],
  ['legal', 'terms_of_use', 'textarea',
    'شروط الاستخدام\n\nاستخدام هذا الموقع متاح للزوار دون إنشاء حساب. تُقدَّم المعلومات للتعريف بالخدمات ولا تُعد تشخيصًا طبيًا ولا نتيجة فحص.\n\nطلب الموعد عبر الموقع لا يعني تأكيده؛ يتم التأكيد هاتفيًا من طرف الفريق. تعتمد الخدمات والأسعار والتوفر على المركز والولاية.\n\nتُبذل عناية معقولة لتحديث معلومات المراكز، ويمكن الإبلاغ عن أي خطأ عبر نموذج التواصل.',
    'Conditions d’utilisation\n\nLe site est accessible aux visiteurs sans création de compte. Les informations présentent les services et ne constituent ni un diagnostic médical ni un résultat d’examen.\n\nUne demande de rendez-vous n’est pas une confirmation : elle est confirmée par téléphone. Les services, tarifs et disponibilités dépendent du centre et de la wilaya.\n\nDes efforts raisonnables sont faits pour tenir à jour les informations des centres ; tout erreur peut être signalée via le formulaire de contact.'],
];

const SETTINGS = [
  ['company_name', 'AUDIOLEF'],
  ['company_email', ''],
  ['default_language', 'ar'],
  ['years_experience', ''],
  ['booking_slot_minutes', '30'],
  ['working_hours_ar', 'السبت – الخميس: 08:30 – 17:00'],
  ['working_hours_fr', 'Samedi – Jeudi : 08h30 – 17h00'],
  ['password_min_length', '10'],
  ['session_idle_minutes', '30'],
  ['notify_new_bookings', '1'],
  ['notify_new_messages', '1'],
  ['brand_primary', '#054937'],
  ['brand_secondary', '#16a34a'],
  ['brand_accent', '#e52323'],
  ['brand_bg', '#f4f7f9'],
  ['brand_ink', '#1f2937'],
  ['hero_media_type', 'image'],
  ['hero_video_url', ''],
  ['backup_note', 'نسخة JSON كاملة من قاعدة البيانات تُنزَّل من هذه الصفحة. يُنصح بالنسخ اليومي والاحتفاظ بنسخة خارج الخادم.'],
];

async function seed(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [id, ar, fr] of WILAYAS) {
      await client.query(
        'INSERT INTO wilayas (id, name_ar, name_fr) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING',
        [id, ar, fr]
      );
    }

    for (const [key, category, ar, fr] of PERMISSIONS) {
      await client.query(
        'INSERT INTO permissions (key, category, name_ar, name_fr) VALUES ($1,$2,$3,$4) ON CONFLICT (key) DO NOTHING',
        [key, category, ar, fr]
      );
    }

    for (const role of ROLES) {
      const res = await client.query(
        `INSERT INTO roles (key, name_ar, name_fr, description_ar, description_fr, is_system, all_centers)
         VALUES ($1,$2,$3,$4,$5,true,$6) ON CONFLICT (key) DO NOTHING RETURNING id`,
        [role.key, role.name_ar, role.name_fr, role.description_ar, role.description_fr, role.all_centers]
      );
      const roleId = res.rows[0]
        ? res.rows[0].id
        : (await client.query('SELECT id FROM roles WHERE key=$1', [role.key])).rows[0].id;
      for (const perm of role.perms) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT $1, id FROM permissions WHERE key=$2 ON CONFLICT DO NOTHING`,
          [roleId, perm]
        );
      }
    }

    for (const s of SERVICES) {
      await client.query(
        `INSERT INTO services (slug, name_ar, name_fr, description_ar, description_fr, duration_min, duration_max, icon, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (slug) DO NOTHING`,
        s
      );
    }

    for (const f of FAQS) {
      const exists = await client.query('SELECT 1 FROM faqs WHERE question_ar=$1', [f[0]]);
      if (!exists.rowCount) {
        await client.query(
          'INSERT INTO faqs (question_ar, question_fr, answer_ar, answer_fr, sort_order) VALUES ($1,$2,$3,$4,$5)',
          [f[0], f[1], f[2], f[3], FAQS.indexOf(f)]
        );
      }
    }

    for (const [section, key, type, ar, fr] of CONTENT) {
      await client.query(
        `INSERT INTO website_content (section, key, type, value_ar, value_fr)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING`,
        [section, key, type, ar, fr]
      );
    }

    for (const [key, value] of SETTINGS) {
      await client.query('INSERT INTO system_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [key, value]);
    }

    // Demo directory + accounts, only on a fresh database.
    const centerCount = Number((await client.query('SELECT count(*) FROM centers')).rows[0].count);
    if (centerCount === 0) {
      const demoCenters = [
        ['ALG-001', 'مركز AUDIOLEF الجزائر الوسطى', 'Centre AUDIOLEF Alger Centre', 16, 'الجزائر الوسطى', 'Alger Centre',
          'شارع ديدوش مراد، الجزائر الوسطى', 'Rue Didouche Mourad, Alger Centre', 36.767600, 3.058900,
          '+213560470019', 'السبت – الخميس: 08:30 – 17:00', 'Samedi – Jeudi : 08h30 – 17h00'],
        ['ORN-001', 'مركز AUDIOLEF وهران', 'Centre AUDIOLEF Oran', 31, 'وهران', 'Oran',
          'حي المدينة الجديدة، وهران', 'Quartier Ville Nouvelle, Oran', 35.697100, -0.633700,
          '+213560470016', 'السبت – الخميس: 09:00 – 17:00', 'Samedi – Jeudi : 09h00 – 17h00'],
        ['CST-001', 'مركز AUDIOLEF قسنطينة', 'Centre AUDIOLEF Constantine', 25, 'قسنطينة', 'Constantine',
          'وسط المدينة، قسنطينة', 'Centre-ville, Constantine', 36.365000, 6.614700,
          '+213560470015', 'الأحد – الخميس: 08:30 – 16:30', 'Dimanche – Jeudi : 08h30 – 16h30'],
      ];
      for (const c of demoCenters) {
        const r = await client.query(
          `INSERT INTO centers (code, name_ar, name_fr, wilaya_id, city_ar, city_fr, address_ar, address_fr,
             latitude, longitude, phone_primary, opening_hours_ar, opening_hours_fr, is_demo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true) RETURNING id`,
          c
        );
        const serviceIds = (await client.query('SELECT id FROM services ORDER BY sort_order')).rows;
        for (const s of serviceIds) {
          await client.query('INSERT INTO center_services (center_id, service_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.rows[0].id, s.id]);
        }
      }
    }

    const empCount = Number((await client.query('SELECT count(*) FROM employees')).rows[0].count);
    if (empCount === 0) {
      const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Audiolef@2026';
      const hash = await bcrypt.hash(initialPassword, 10);
      const firstCenter = (await client.query('SELECT id FROM centers ORDER BY id LIMIT 1')).rows[0];
      const accounts = [
        ['مدير المنصة التجريبي', 'admin', 'admin@audiolef.dz', 'super_admin', null, 'مدير المنصة', 'Administrateur'],
        ['مدير مركز تجريبي', 'manager', 'manager@audiolef.dz', 'center_manager', firstCenter?.id || null, 'مدير مركز', 'Responsable de centre'],
        ['موظف استقبال تجريبي', 'reception', 'reception@audiolef.dz', 'receptionist', firstCenter?.id || null, 'موظف استقبال', 'Réceptionniste'],
        ['أخصائي سمع تجريبي', 'audiologist', 'audiologist@audiolef.dz', 'audiologist', firstCenter?.id || null, 'أخصائي سمع', 'Audioprothésiste'],
        ['مسؤول محتوى تجريبي', 'content', 'content@audiolef.dz', 'content_manager', null, 'مسؤول محتوى', 'Responsable de contenu'],
      ];
      for (const [fullName, username, email, roleKey, centerId, titleAr, titleFr] of accounts) {
        const ins = await client.query(
          `INSERT INTO employees (full_name, username, email, password_hash, center_id, job_title_ar, job_title_fr,
             is_demo, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,$7,true,true) RETURNING id`,
          [fullName, username, email, hash, centerId, titleAr, titleFr]
        );
        await client.query(
          `INSERT INTO employee_roles (employee_id, role_id) SELECT $1, id FROM roles WHERE key=$2`,
          [ins.rows[0].id, roleKey]
        );
      }
    }

    const bookingCount = Number((await client.query('SELECT count(*) FROM bookings')).rows[0].count);
    if (bookingCount === 0) {
      const center = (await client.query('SELECT id, wilaya_id, city_ar FROM centers ORDER BY id LIMIT 1')).rows[0];
      const service = (await client.query("SELECT id FROM services WHERE slug='hearing-assessment'")).rows[0];
      const demoBookings = [
        ['أمينة بن علي', '+213555100200', 'new', '2026-11-12', '10:00',
          'أشعر بصعوبة في متابعة الحديث في الأماكن المزدحمة.'],
        ['يوسف مرابط', '+213555100201', 'confirmed', '2026-11-13', '14:30',
          'أرغب في فحص سمع لوالدي الذي يستخدم جهازًا قديمًا.'],
      ];
      for (const [name, phone, status, date, time, notes] of demoBookings) {
        const cust = await client.query(
          `INSERT INTO customers (full_name, phone, wilaya_id, city, is_demo)
           VALUES ($1,$2,$3,$4,true) ON CONFLICT DO NOTHING RETURNING id`,
          [name, phone, center.wilaya_id, center.city_ar]
        );
        const customerId = cust.rows[0]
          ? cust.rows[0].id
          : (await client.query('SELECT id FROM customers WHERE phone=$1', [phone])).rows[0].id;
        const ref = 'ALF-2611-' + String(Math.floor(Math.random() * 9000) + 1000);
        await client.query(
          `INSERT INTO bookings (reference, customer_id, customer_name, phone, wilaya_id, city, center_id, service_id,
             preferred_date, preferred_time, notes, status, is_demo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)`,
          [ref, customerId, name, phone, center.wilaya_id, center.city_ar, center.id, service.id, date, time, notes, status]
        );
      }
      await client.query(
        `INSERT INTO contact_messages (full_name, phone, subject, body, is_demo)
         VALUES ('زائر تجريبي', '+213555100299', 'استفسار عن المواعيد', 'رسالة تجريبية للتوضيح فقط: هل يمكن الحصول على موعد خلال هذا الأسبوع؟', true)`
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { seed };
