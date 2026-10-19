"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import styles from "./invitation.module.css";

const ASSET_PATH = "/designer-invitation";

const stories = [
  {
    channel: "Meta · Google Ads",
    title: (
      <>
        Atölyenizden
        <br />
        yeni ekranlara.
      </>
    ),
    copy: "Ürünlerinizi merkeze alan reklam çalışmalarıyla, tasarımınıza ilgi duyabilecek insanlara ulaşmayı hedefliyoruz.",
    caption: "İlk bakışta fark edilen.",
  },
  {
    channel: "Pinterest",
    title: (
      <>
        Bir fikrin
        <br />
        peşinden gelenlere.
      </>
    ),
    copy: "İlham arayanların yoluna çıkalım. Ürünlerinizi, insanların gelecekteki yaşam alanlarını hayal ettiği yerde anlatalım.",
    caption: "Bir hayalin parçası olan.",
  },
  {
    channel: "İçerik üreticisi iş birlikleri",
    title: (
      <>
        Hikâyeniz,
        <br />
        başka seslerle.
      </>
    ),
    copy: "Tasarımın dilini bilen içerik üreticileriyle iş birlikleri planlıyoruz. Ürününüzü yalnızca göstermek değil, arkasındaki fikri de duyurmak için.",
    caption: "Arkasındaki emekle tanınan.",
  },
] as const;

const panelViews = [
  {
    label: "Panel turu",
    description: "Sipariş, ürün ve kargo akışına kısa bir bakış.",
    image: "panel-orders.webp",
  },
  {
    label: "Siparişler",
    description:
      "Gelen siparişleri görün, detaylarına ulaşın ve hazırlık sürecini takip edin.",
    image: "panel-orders.webp",
  },
  {
    label: "Ürün & stok",
    description:
      "Ürünlerinizi bir arada görün; fiyat ve stok bilgilerinizi yönetin.",
    image: "panel-products.webp",
  },
  {
    label: "Kargo",
    description:
      "Hazırlıktan gönderime, kargolarınızın durumunu tek yerden takip edin.",
    image: "panel-shipping.webp",
  },
] as const;

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
    >
      {diagonal ? (
        <path
          d="M5 19 19 5M5 5h14v14"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      ) : (
        <path
          d="M3 12h17m-6-6 6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      )}
    </svg>
  );
}

function ApplyLink({
  href,
  children = "Tasarımcı olarak katılın",
  light = false,
}: {
  href: string;
  children?: ReactNode;
  light?: boolean;
}) {
  return (
    <a
      className={`${styles.applyLink} ${light ? styles.applyLinkLight : ""}`}
      href={href}
    >
      <span>{children}</span>
      <Arrow diagonal />
    </a>
  );
}

function SectionLabel({
  number,
  children,
}: {
  number: string;
  children: ReactNode;
}) {
  return (
    <p className={styles.sectionLabel}>
      <span>{number}</span>
      {children}
    </p>
  );
}

export function InvitationExperience({
  applicationUrl,
}: {
  applicationUrl: string;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const storyMediaRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeStory, setActiveStory] = useState(0);
  const [activePanel, setActivePanel] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    const story = storyRef.current;
    if (!root || !story) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let revealObserver: IntersectionObserver | undefined;
    if (!reducedMotion.matches && "IntersectionObserver" in window) {
      revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            (entry.target as HTMLElement).dataset.revealState = "visible";
            revealObserver?.unobserve(entry.target);
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px -5% 0px" },
      );

      root.querySelectorAll<HTMLElement>("[data-reveal]").forEach((element) => {
        // Server-rendered content stays visible without JavaScript or observers.
        if (element.getBoundingClientRect().top > window.innerHeight) {
          element.dataset.revealState = "waiting";
          revealObserver?.observe(element);
        }
      });
    }

    const steps = Array.from(
      story.querySelectorAll<HTMLElement>("[data-story-step]"),
    );
    let frame = 0;
    let previousStep = 0;
    const updateStory = () => {
      frame = 0;
      const bounds = story.getBoundingClientRect();
      if (bounds.top > window.innerHeight || bounds.bottom < 0) return;

      let nextStep = 0;
      steps.forEach((step, index) => {
        if (step.getBoundingClientRect().top <= window.innerHeight * 0.58)
          nextStep = index;
      });
      if (nextStep !== previousStep) {
        previousStep = nextStep;
        setActiveStory(nextStep);
      }
      if (!reducedMotion.matches) {
        const progress = Math.max(
          0,
          Math.min(
            1,
            (window.innerHeight - bounds.top) /
              (bounds.height + window.innerHeight),
          ),
        );
        storyMediaRef.current?.style.setProperty(
          "--story-shift",
          `${(progress - 0.5) * -7}%`,
        );
      }
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(updateStory);
    };
    updateStory();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      revealObserver?.disconnect();
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (activePanel !== 0) videoRef.current?.pause();
  }, [activePanel]);

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const offsets: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    let next = activePanel;
    if (event.key in offsets)
      next =
        (activePanel + (offsets[event.key] ?? 0) + panelViews.length) %
        panelViews.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = panelViews.length - 1;
    else return;
    event.preventDefault();
    setActivePanel(next);
    tabRefs.current[next]?.focus();
  }

  const currentStory = stories[activeStory] ?? stories[0];
  const currentPanel = panelViews[activePanel] ?? panelViews[0];

  return (
    <main ref={rootRef} className={styles.invitation}>
      <a className={styles.skipLink} href="#davet">
        Daveti keşfet
      </a>

      <section className={styles.hero} aria-labelledby="invitation-title">
        <Image
          className={styles.heroImage}
          src={`${ASSET_PATH}/hero.webp`}
          alt="Doğal ışıkla aydınlanan bir mekânda heykelsi ahşap koltuk ve traverten sehpa"
          fill
          priority
          unoptimized
          sizes="100vw"
          quality={90}
        />
        <div className={styles.heroRail}>
          <span>Tasarımcılar için bir davet</span>
          <a href={applicationUrl}>
            Başvuru yapın <Arrow diagonal />
          </a>
        </div>
        <div className={styles.wordmark} aria-label="Hanuja">
          hanuja
        </div>
        <div className={styles.heroCopy}>
          <h1 id="invitation-title">
            İyi tasarım,
            <br />
            doğru insanlarla
            <br />
            buluşmalı.
          </h1>
          <p>Siz üretin. Yeni kapıları birlikte açalım.</p>
          <ApplyLink href={applicationUrl} />
        </div>
        <div className={styles.heroBottom}>
          <a className={styles.scrollCue} href="#davet">
            <span aria-hidden="true">↓</span> Birlikte neler yapabiliriz?
          </a>
          <span className={styles.heroSignature}>
            Özgün tasarımlar.
            <br />
            Ortak bir gelecek.
          </span>
        </div>
      </section>

      <section
        id="davet"
        className={styles.visibility}
        aria-labelledby="visibility-title"
      >
        <div className={styles.sectionIntro} data-reveal>
          <SectionLabel number="01">Görünürlük</SectionLabel>
          <div className={styles.introGrid}>
            <h2 id="visibility-title">
              Güzel şeyler,
              <br />
              <span>keşfedilmeyi hak eder.</span>
            </h2>
            <p>
              Her tasarımın bir bakış açısı var.
              <br />
              Bizim işimiz, onu daha çok insanla buluşturmak.
            </p>
          </div>
        </div>

        <div ref={storyRef} className={styles.story}>
          <figure ref={storyMediaRef} className={styles.storyMedia}>
            <Image
              className={styles.storyImage}
              src={`${ASSET_PATH}/detail.webp`}
              alt="Bir seramik ustasının, dokulu ve kıvrımlı bir vazoya elleriyle son şeklini vermesi"
              fill
              unoptimized
              sizes="(max-width: 760px) 100vw, 54vw"
            />
            <figcaption className={styles.storyCaption}>
              <div className={styles.storyProgress} aria-hidden="true">
                {stories.map((_, index) => (
                  <span key={index} data-active={index === activeStory} />
                ))}
              </div>
              <div>
                <span>{currentStory.caption}</span>
                <span>0{activeStory + 1} / 03</span>
              </div>
            </figcaption>
          </figure>
          <div className={styles.storySteps}>
            {stories.map((story, index) => (
              <article
                key={story.channel}
                className={styles.storyStep}
                data-story-step
                data-active={index === activeStory}
              >
                <div data-reveal>
                  <p className={styles.eyebrow}>
                    <span>0{index + 1}</span>
                    {story.channel}
                  </p>
                  <h3>{story.title}</h3>
                  <p className={styles.storyCopy}>{story.copy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
        <p className={styles.campaignNote}>
          Tanıtım planımızı koleksiyonlar, mevsimler ve kampanyalar etrafında
          birlikte şekillendiriyoruz.
        </p>
      </section>

      <section className={styles.economics} aria-labelledby="economics-title">
        <SectionLabel number="02">Birlikte büyümek</SectionLabel>
        <div className={styles.economicsGrid}>
          <h2 id="economics-title" data-reveal>
            Emeğinizin
            <br />
            karşılığı,
            <br />
            <span>sizinle kalsın.</span>
          </h2>
          <div className={styles.economicsDetails}>
            <div data-reveal>
              <h3>
                Düşük komisyon.
                <br />
                Uzun vadeli ortaklık.
              </h3>
              <p>
                Tasarımcının kazancını gözeten düşük komisyon yaklaşımıyla
                çalışıyoruz. Koşulları en başta, birlikte netleştiriyoruz.
              </p>
            </div>
            <div data-reveal>
              <h3>
                Görünürlüğe
                <br />
                geri dönen gelir.
              </h3>
              <p>
                Gelirimizin önemli bir bölümünü reklam çalışmalarına ve
                tasarımcılarımızın tanıtımına ayırmayı planlıyoruz. Siz
                büyüdükçe anlam kazanan bir iş birliği.
              </p>
            </div>
          </div>
        </div>
        <div className={styles.economicsFoot}>
          <span>İyi tasarımın sürdürülebilir bir geleceği olsun.</span>
          <Arrow diagonal />
        </div>
      </section>

      <section className={styles.onboarding} aria-labelledby="onboarding-title">
        <div className={styles.sectionIntro} data-reveal>
          <SectionLabel number="03">Kolay bir başlangıç</SectionLabel>
          <div className={styles.introGrid}>
            <h2 id="onboarding-title">
              Siz tasarlayın.
              <br />
              <span>Birlikte yayına alalım.</span>
            </h2>
            <p>
              Teknik yükü üzerinizden alıyoruz.
              <br />
              Ürün yükleme desteğimiz ücretsiz.
            </p>
          </div>
        </div>
        <ol className={styles.steps}>
          <li data-reveal>
            <span className={styles.stepNumber}>01</span>
            <h3>Tanışalım.</h3>
            <p>
              Kısa başvuru formunda markanızı ve tasarımlarınızı paylaşın. İş
              birliğine ilk adımı birlikte atalım.
            </p>
          </li>
          <li data-reveal>
            <span className={styles.stepNumber}>02</span>
            <h3>
              İş birliğimizi
              <br />
              netleştirelim.
            </h3>
            <p>
              Başvurunuzun değerlendirilmesinin ardından gerekli belgeleri ve
              sözleşmeleri tamamlayalım. Satış koşulları baştan belli olsun.
            </p>
          </li>
          <li data-reveal>
            <span className={styles.stepNumber}>03</span>
            <h3>
              Ürünlerinizi
              <br />
              <span>ücretsiz yükleyelim.</span>
            </h3>
            <p>
              Web sitenizden ya da paylaştığınız görsel ve ürün bilgilerinden
              ilerleyelim. Yazılım ve entegrasyon ekibimiz ürünlerinizi sizin
              için yüklesin.
            </p>
          </li>
        </ol>
        <a className={styles.textLink} href={applicationUrl}>
          İlk adımı atın <Arrow diagonal />
        </a>
      </section>

      <section className={styles.panel} aria-labelledby="panel-title">
        <div className={styles.sectionIntro} data-reveal>
          <SectionLabel number="04">Tasarımcı paneliniz</SectionLabel>
          <div className={styles.introGrid}>
            <h2 id="panel-title">
              Her şey yerli yerinde.
              <br />
              <span>Aklınız tasarımınızda.</span>
            </h2>
            <p>
              Siparişler, ürünler, stok ve kargo.
              <br />
              Günlük işlerinizi tek bir panelden takip edin.
            </p>
          </div>
        </div>
        <div className={styles.panelShowcase} data-reveal>
          <div className={styles.panelTopline}>
            <span>
              <span className={styles.statusDot} />
              Hanuja · Tasarımcı paneli
            </span>
            <span>İşin mutfağına bir bakış</span>
          </div>
          <div
            className={styles.panelTabs}
            role="tablist"
            aria-label="Tasarımcı panelini keşfedin"
            onKeyDown={handleTabKeyDown}
          >
            {panelViews.map((view, index) => (
              <button
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                key={view.label}
                type="button"
                role="tab"
                id={`panel-tab-${index}`}
                aria-selected={activePanel === index}
                aria-controls={`panel-view-${index}`}
                tabIndex={activePanel === index ? 0 : -1}
                onClick={() => setActivePanel(index)}
              >
                <span aria-hidden="true">0{index}</span>
                {view.label}
                {index === 0 ? (
                  <span className={styles.playIcon} aria-hidden="true">
                    ▷
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {panelViews.map((view, index) => (
            <div
              key={view.label}
              id={`panel-view-${index}`}
              role="tabpanel"
              aria-labelledby={`panel-tab-${index}`}
              hidden={activePanel !== index}
              tabIndex={0}
              className={styles.panelView}
            >
              {index === 0 ? (
                <video
                  ref={videoRef}
                  controls
                  playsInline
                  preload="none"
                  poster={`${ASSET_PATH}/panel-orders.webp`}
                  aria-label="Gerçek Hanuja tasarımcı panelinde sipariş, ürün ve kargo ekranlarının sessiz tanıtım videosu"
                  className={styles.panelVideo}
                >
                  <source
                    src={`${ASSET_PATH}/panel-tour.webm`}
                    type="video/webm"
                  />
                  Tarayıcınız bu videoyu oynatamıyor.{" "}
                  <a href={`${ASSET_PATH}/panel-tour.webm`}>
                    Panel turunu indirin.
                  </a>
                </video>
              ) : (
                <a
                  className={styles.panelZoom}
                  href={`${ASSET_PATH}/${view.image}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${view.label} ekranını tam boyutta aç (yeni sekme)`}
                >
                  <Image
                    src={`${ASSET_PATH}/${view.image}`}
                    alt={`Hanuja tasarımcı paneli: ${view.label}. ${view.description}`}
                    width={1440}
                    height={1000}
                    sizes="(max-width: 760px) 100vw, 90vw"
                    className={styles.panelImage}
                    unoptimized
                  />
                  <span className={styles.panelZoomLabel}>
                    Görüntüyü büyüt <Arrow diagonal />
                  </span>
                </a>
              )}
            </div>
          ))}
          <div className={styles.panelCaption}>
            <p>{currentPanel.description}</p>
            <span>Gerçek panel · Örnek veriler</span>
          </div>
        </div>
      </section>

      <section className={styles.faq} aria-labelledby="faq-title">
        <div>
          <p className={styles.eyebrow}>Birlikte netleştirelim</p>
          <h2 id="faq-title">
            Aklınızdaki
            <br /> sorular.
          </h2>
        </div>
        <div className={styles.faqList}>
          <details>
            <summary>
              Kimler başvurabilir?<span aria-hidden="true">+</span>
            </summary>
            <p>
              Özgün tasarım ürünleri sunan tasarımcılar ve markalar
              başvurabilir. Başvuruları ürünleriniz ve markanız üzerinden
              değerlendiriyor; uygun iş birliklerinde belge ve sözleşme sürecine
              geçiyoruz.
            </p>
          </details>
          <details>
            <summary>
              Ürün yükleme desteği ücretli mi?<span aria-hidden="true">+</span>
            </summary>
            <p>
              Hayır, ücretsiz. Web sitenizi ya da ürün görsellerinizi ve
              bilgilerinizi bizimle paylaşmanız yeterli. Yazılım ve entegrasyon
              ekibimiz, ürünlerinizin yüklenmesinde size destek olur.
            </p>
          </details>
          <details>
            <summary>
              Komisyon oranı nasıl belirleniyor?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Uygulanacak komisyon ve diğer ticari koşullar iş birliği
              başlamadan önce sizinle paylaşılır ve sözleşmede netleşir.
              Başvurmak, bu koşulları kabul etmek anlamına gelmez.
            </p>
          </details>
          <details>
            <summary>
              Fatura, gönderim ve iadeler nasıl ilerliyor?
              <span aria-hidden="true">+</span>
            </summary>
            <p>
              Müşteriye satış ve faturalama Hanuja üzerinden yürür. Siz ürünleri
              hazırlar, gönderir ve Hanuja’ya faturalandırırsınız. Müşteri
              desteğini ve iade taleplerini Hanuja yönetir; ürünün iade ve
              inceleme adımlarında sizinle koordineli ilerleriz.
            </p>
          </details>
        </div>
      </section>

      <section className={styles.finalCta} aria-labelledby="join-title">
        <p className={styles.eyebrow}>Tasarımınıza yer açtık.</p>
        <div className={styles.finalHeading}>
          <h2 id="join-title">
            Bir sonraki
            <br />
            hikâye, <em>sizin.</em>
          </h2>
          <span className={styles.finalArrow} aria-hidden="true">
            <Arrow diagonal />
          </span>
        </div>
        <div className={styles.finalAction}>
          <ApplyLink href={applicationUrl} light>
            Birlikte başlayalım
          </ApplyLink>
          <a className={styles.contactLink} href="mailto:admin@hanuja.com.tr">
            Önce konuşmak isterseniz <Arrow />
          </a>
        </div>
        <footer className={styles.footer}>
          <span className={styles.footerBrand}>hanuja</span>
          <span>Tasarımcılarla, tasarım için.</span>
          <a href="/gizlilik-politikasi">Gizlilik</a>
        </footer>
      </section>
    </main>
  );
}
